//! `core.switch`: tests earlier nodes' outputs and leaves through one named output (an XYFlow `sourceHandle`).
//! Rules are tried in order; the first match wins, then `fallback`. With no match and no fallback the node fails,
//! so a run never ends silently on an unexpected value.

use super::{read_output, write_output};
use async_trait::async_trait;
use oxidizedgraph::error::NodeError;
use oxidizedgraph::graph::{NodeExecutor, NodeOutput};
use oxidizedgraph::state::SharedState;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeSet;

pub const NODE_TYPE: &str = "core.switch";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Params {
    rules: Vec<Rule>,
    #[serde(default)]
    fallback: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    /// Output taken when the rule matches.
    pub handle: String,
    /// Node whose output is tested.
    pub node: String,
    /// JSON Pointer into that output, such as `/status` or `/body/items/0/id`. Empty means the whole output.
    #[serde(default)]
    pub pointer: String,
    pub op: Op,
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Op {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    /// The pointer resolves to a value other than null.
    Exists,
    /// String contains a substring, or array contains an element.
    Contains,
}

pub struct SwitchNode {
    id: String,
    rules: Vec<Rule>,
    fallback: Option<String>,
}

impl SwitchNode {
    pub fn from_params(id: &str, parameters: &Value) -> Result<Self, String> {
        let params: Params =
            serde_json::from_value(parameters.clone()).map_err(|e| format!("parameters: {e}"))?;
        if params.rules.is_empty() && params.fallback.is_none() {
            return Err("a switch needs at least one rule or a fallback".into());
        }
        for (i, rule) in params.rules.iter().enumerate() {
            if rule.handle.is_empty() {
                return Err(format!("rule {i} has an empty handle"));
            }
            if !rule.pointer.is_empty() && !rule.pointer.starts_with('/') {
                return Err(format!(
                    "rule {i}: pointer {:?} must be empty or start with '/'",
                    rule.pointer
                ));
            }
            if matches!(rule.op, Op::Gt | Op::Gte | Op::Lt | Op::Lte) && !rule.value.is_number() {
                return Err(format!(
                    "rule {i}: {:?} compares numbers, so value must be a number",
                    rule.op
                ));
            }
        }
        if params.fallback.as_deref() == Some("") {
            return Err("fallback handle is empty".into());
        }
        Ok(Self {
            id: id.to_string(),
            rules: params.rules,
            fallback: params.fallback,
        })
    }

    /// Every output this node can take.
    pub fn handles(&self) -> Vec<String> {
        let mut handles: BTreeSet<String> = self.rules.iter().map(|r| r.handle.clone()).collect();
        handles.extend(self.fallback.clone());
        handles.into_iter().collect()
    }

    pub fn reads(&self) -> Vec<String> {
        let reads: BTreeSet<String> = self.rules.iter().map(|r| r.node.clone()).collect();
        reads.into_iter().collect()
    }
}

#[async_trait]
impl NodeExecutor for SwitchNode {
    fn id(&self) -> &str {
        &self.id
    }

    async fn execute(&self, state: SharedState) -> Result<NodeOutput, NodeError> {
        let mut chosen = None;
        for rule in &self.rules {
            let output = read_output(&state, &rule.node)?;
            let actual = output.as_ref().and_then(|o| o.pointer(&rule.pointer));
            if matches(rule.op, actual, &rule.value) {
                chosen = Some(rule.handle.clone());
                break;
            }
        }
        let handle = chosen.or_else(|| self.fallback.clone()).ok_or_else(|| {
            NodeError::ExecutionFailed(format!(
                "switch {:?}: no rule matched and there is no fallback",
                self.id
            ))
        })?;
        write_output(&state, &self.id, serde_json::json!({ "handle": handle }))?;
        Ok(NodeOutput::transition(handle))
    }

    fn description(&self) -> Option<&str> {
        Some("Switch")
    }
}

fn matches(op: Op, actual: Option<&Value>, expected: &Value) -> bool {
    match op {
        Op::Exists => actual.is_some_and(|v| !v.is_null()),
        Op::Eq => actual == Some(expected),
        Op::Ne => actual != Some(expected),
        Op::Gt | Op::Gte | Op::Lt | Op::Lte => {
            match (actual.and_then(Value::as_f64), expected.as_f64()) {
                (Some(a), Some(b)) => match op {
                    Op::Gt => a > b,
                    Op::Gte => a >= b,
                    Op::Lt => a < b,
                    _ => a <= b,
                },
                _ => false,
            }
        }
        Op::Contains => match (actual, expected) {
            (Some(Value::String(s)), Value::String(needle)) => s.contains(needle.as_str()),
            (Some(Value::Array(items)), needle) => items.contains(needle),
            _ => false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn operators() {
        let n = json!(503);
        assert!(matches(Op::Eq, Some(&n), &json!(503)));
        assert!(matches(Op::Ne, Some(&n), &json!(200)));
        assert!(matches(Op::Ne, None, &json!(200)));
        assert!(matches(Op::Gte, Some(&n), &json!(500)));
        assert!(!matches(Op::Lt, Some(&n), &json!(500)));
        assert!(!matches(Op::Gt, Some(&json!("600")), &json!(500)));
        assert!(matches(
            Op::Contains,
            Some(&json!("gateway timeout")),
            &json!("timeout")
        ));
        assert!(matches(Op::Contains, Some(&json!(["a", "b"])), &json!("b")));
        assert!(matches(Op::Exists, Some(&json!(0)), &Value::Null));
        assert!(!matches(Op::Exists, Some(&Value::Null), &Value::Null));
        assert!(!matches(Op::Exists, None, &Value::Null));
    }

    #[test]
    fn parameters_are_checked_at_compile_time() {
        assert!(SwitchNode::from_params("s", &json!({ "rules": [] })).is_err());
        assert!(SwitchNode::from_params("s", &json!({ "rules": [], "fallback": "other" })).is_ok());
        let bad_pointer = json!({ "rules": [{ "handle": "a", "node": "h", "pointer": "status", "op": "eq", "value": 1 }] });
        assert!(SwitchNode::from_params("s", &bad_pointer).is_err());
        let non_numeric =
            json!({ "rules": [{ "handle": "a", "node": "h", "op": "gt", "value": "5" }] });
        assert!(SwitchNode::from_params("s", &non_numeric).is_err());
    }

    #[test]
    fn handles_and_reads_are_declared() {
        let s = SwitchNode::from_params(
            "s",
            &json!({
                "rules": [
                    { "handle": "ok", "node": "h", "pointer": "/status", "op": "eq", "value": 200 },
                    { "handle": "ok", "node": "g", "pointer": "/status", "op": "eq", "value": 204 }
                ],
                "fallback": "down"
            }),
        )
        .unwrap();
        assert_eq!(s.handles(), vec!["down", "ok"]);
        assert_eq!(s.reads(), vec!["g", "h"]);
    }
}
