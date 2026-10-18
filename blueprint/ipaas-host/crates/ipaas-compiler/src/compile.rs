use crate::nodes::{http, switch};
use crate::{BlueprintNode, RuntimeTarget, WorkflowBlueprint};
use async_trait::async_trait;
use oxidizedgraph::error::{GraphError, NodeError};
use oxidizedgraph::graph::{CompiledGraph, GraphBuilder, NodeExecutor, NodeOutput};
use oxidizedgraph::state::SharedState;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;

#[derive(Debug, thiserror::Error)]
pub enum CompileError {
    #[error("blueprint has no nodes")]
    Empty,
    #[error("node id {0:?} is used more than once")]
    DuplicateNode(String),
    #[error("edge {from:?} → {to:?} references an unknown node")]
    UnknownEdgeEndpoint { from: String, to: String },
    #[error("edge {from:?} → {to:?} uses condition_expr; branch with a core.switch node and source_handle")]
    ConditionExprUnsupported { from: String, to: String },
    #[error("every node has an incoming edge; set `entry`")]
    NoEntry,
    #[error("several nodes have no incoming edge ({0:?}); set `entry`")]
    AmbiguousEntry(Vec<String>),
    #[error("entry {0:?} is not a node")]
    UnknownEntry(String),
    #[error("node {node:?}: no executor registered for {node_type:?}")]
    UnknownNodeType { node: String, node_type: String },
    #[error("node {node:?}: {node_type:?} runs on {expected:?}, not {got:?}")]
    RuntimeMismatch {
        node: String,
        node_type: String,
        expected: RuntimeTarget,
        got: RuntimeTarget,
    },
    #[error("node {node:?}: {reason}")]
    InvalidParameters { node: String, reason: String },
    #[error("node {node:?} reads the output of unknown node {reads:?}")]
    UnknownReference { node: String, reads: String },
    #[error("edge {from:?} → {to:?} needs a source_handle; {from:?} has several outputs")]
    MissingHandle { from: String, to: String },
    #[error("edge from {from:?} uses handle {handle:?}, which that node does not declare")]
    UnknownHandle { from: String, handle: String },
    #[error("edge from {from:?} uses handle {handle:?}, but that node has a single output")]
    UnexpectedHandle { from: String, handle: String },
    #[error("{from:?} has several edges from one output; parallel fan-out is not supported yet")]
    FanOutUnsupported { from: String },
    #[error(transparent)]
    Graph(#[from] GraphError),
}

/// What a factory builds for one blueprint node.
pub struct CompiledNode {
    pub executor: Arc<dyn NodeExecutor>,
    /// `None`: one default output, so edges carry no `source_handle`.
    /// `Some`: the named outputs the node can take; each edge picks one with `source_handle`.
    pub output_handles: Option<Vec<String>>,
    /// Node ids whose outputs this node reads.
    pub reads: Vec<String>,
}

pub type NodeFactory = Arc<dyn Fn(&BlueprintNode) -> Result<CompiledNode, String> + Send + Sync>;

/// Maps `node_type` to the runtime it must declare and the factory that builds its executor.
#[derive(Clone, Default)]
pub struct NodeRegistry {
    factories: HashMap<String, (RuntimeTarget, NodeFactory)>,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// The native Rust primitives: `core.http_request` and `core.switch`.
    pub fn with_core_nodes(http_policy: http::HttpPolicy) -> Self {
        let mut registry = Self::new();
        let policy = Arc::new(http_policy);
        registry.register(
            http::NODE_TYPE,
            RuntimeTarget::RustNative,
            Arc::new(move |node: &BlueprintNode| {
                let executor =
                    http::HttpRequestNode::from_params(&node.id, &node.parameters, policy.clone())?;
                Ok(CompiledNode {
                    executor: Arc::new(executor),
                    output_handles: None,
                    reads: vec![],
                })
            }),
        );
        registry.register(
            switch::NODE_TYPE,
            RuntimeTarget::RustNative,
            Arc::new(|node: &BlueprintNode| {
                let executor = switch::SwitchNode::from_params(&node.id, &node.parameters)?;
                Ok(CompiledNode {
                    output_handles: Some(executor.handles()),
                    reads: executor.reads(),
                    executor: Arc::new(executor),
                })
            }),
        );
        registry
    }

    pub fn register(
        &mut self,
        node_type: impl Into<String>,
        runtime: RuntimeTarget,
        factory: NodeFactory,
    ) {
        self.factories.insert(node_type.into(), (runtime, factory));
    }
}

/// Structural checks that need no registry.
pub fn validate_blueprint(bp: &WorkflowBlueprint) -> Result<(), CompileError> {
    if bp.nodes.is_empty() {
        return Err(CompileError::Empty);
    }
    let mut ids = HashSet::new();
    for node in &bp.nodes {
        if !ids.insert(node.id.as_str()) {
            return Err(CompileError::DuplicateNode(node.id.clone()));
        }
    }
    for edge in &bp.edges {
        if !ids.contains(edge.source.as_str()) || !ids.contains(edge.target.as_str()) {
            return Err(CompileError::UnknownEdgeEndpoint {
                from: edge.source.clone(),
                to: edge.target.clone(),
            });
        }
        if edge.condition_expr.is_some() {
            return Err(CompileError::ConditionExprUnsupported {
                from: edge.source.clone(),
                to: edge.target.clone(),
            });
        }
    }
    Ok(())
}

/// Compiles a blueprint into a graph for oxidizedgraph's `GraphRunner`.
///
/// Each node writes its output to `AgentState::context` under [`crate::nodes::output_key`].
/// Cycles are allowed; the runner's `max_iterations` bounds them.
pub fn compile(
    bp: &WorkflowBlueprint,
    registry: &NodeRegistry,
) -> Result<CompiledGraph, CompileError> {
    validate_blueprint(bp)?;
    let entry = entry_node(bp)?;
    let ids: HashSet<&str> = bp.nodes.iter().map(|n| n.id.as_str()).collect();

    let mut builder = GraphBuilder::new()
        .name(format!("workflow-{}", bp.workflow_id))
        .set_entry_point(entry);
    let mut handles_by_node = HashMap::new();
    for node in &bp.nodes {
        let (runtime, factory) = registry.factories.get(&node.node_type).ok_or_else(|| {
            CompileError::UnknownNodeType {
                node: node.id.clone(),
                node_type: node.node_type.clone(),
            }
        })?;
        if *runtime != node.runtime {
            return Err(CompileError::RuntimeMismatch {
                node: node.id.clone(),
                node_type: node.node_type.clone(),
                expected: *runtime,
                got: node.runtime,
            });
        }
        let compiled = factory(node).map_err(|reason| CompileError::InvalidParameters {
            node: node.id.clone(),
            reason,
        })?;
        if compiled.executor.id() != node.id {
            return Err(CompileError::InvalidParameters {
                node: node.id.clone(),
                reason: format!(
                    "factory built an executor with id {:?}",
                    compiled.executor.id()
                ),
            });
        }
        if let Some(reads) = compiled.reads.iter().find(|r| !ids.contains(r.as_str())) {
            return Err(CompileError::UnknownReference {
                node: node.id.clone(),
                reads: reads.clone(),
            });
        }
        handles_by_node.insert(node.id.as_str(), compiled.output_handles);
        builder = builder.add_node(Bound(compiled.executor));
    }

    for node in &bp.nodes {
        let outgoing: Vec<_> = bp.edges.iter().filter(|e| e.source == node.id).collect();
        match &handles_by_node[node.id.as_str()] {
            None => {
                if let Some(edge) = outgoing.iter().find(|e| e.source_handle.is_some()) {
                    return Err(CompileError::UnexpectedHandle {
                        from: edge.source.clone(),
                        handle: edge.source_handle.clone().unwrap_or_default(),
                    });
                }
                match outgoing.as_slice() {
                    [] => builder = builder.add_edge_to_end(&node.id),
                    [edge] => builder = builder.add_edge(&edge.source, &edge.target),
                    _ => {
                        return Err(CompileError::FanOutUnsupported {
                            from: node.id.clone(),
                        })
                    }
                }
            }
            Some(declared) => {
                let mut used = BTreeSet::new();
                for edge in outgoing {
                    let handle =
                        edge.source_handle
                            .as_ref()
                            .ok_or_else(|| CompileError::MissingHandle {
                                from: edge.source.clone(),
                                to: edge.target.clone(),
                            })?;
                    if !declared.contains(handle) {
                        return Err(CompileError::UnknownHandle {
                            from: edge.source.clone(),
                            handle: handle.clone(),
                        });
                    }
                    if !used.insert(handle.as_str()) {
                        return Err(CompileError::FanOutUnsupported {
                            from: node.id.clone(),
                        });
                    }
                    builder = builder.add_edge_with_key(&edge.source, &edge.target, handle);
                }
                // A handle with no edge ends the run, as an unconnected output does on the canvas.
            }
        }
    }

    Ok(builder.compile()?)
}

fn entry_node(bp: &WorkflowBlueprint) -> Result<String, CompileError> {
    if let Some(entry) = &bp.entry {
        return if bp.nodes.iter().any(|n| &n.id == entry) {
            Ok(entry.clone())
        } else {
            Err(CompileError::UnknownEntry(entry.clone()))
        };
    }
    let targets: HashSet<&str> = bp.edges.iter().map(|e| e.target.as_str()).collect();
    let roots: Vec<String> = bp
        .nodes
        .iter()
        .filter(|n| !targets.contains(n.id.as_str()))
        .map(|n| n.id.clone())
        .collect();
    match roots.len() {
        0 => Err(CompileError::NoEntry),
        1 => Ok(roots.into_iter().next().unwrap_or_default()),
        _ => Err(CompileError::AmbiguousEntry(roots)),
    }
}

/// `GraphBuilder::add_node` takes an executor by value; factories hand back shared ones.
struct Bound(Arc<dyn NodeExecutor>);

#[async_trait]
impl NodeExecutor for Bound {
    fn id(&self) -> &str {
        self.0.id()
    }

    async fn execute(&self, state: SharedState) -> Result<NodeOutput, NodeError> {
        self.0.execute(state).await
    }

    fn description(&self) -> Option<&str> {
        self.0.description()
    }
}
