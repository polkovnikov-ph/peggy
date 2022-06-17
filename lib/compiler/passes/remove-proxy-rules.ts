import { findRule } from "../asts";
import { buildVisitor } from "../visitor";
import type { Pass } from "./pass";
import type * as a from '../../parser';

// Removes proxy rules -- that is, rules that only delegate to other rule.
export const removeProxyRules: Pass = (ast, options, session) => {
  const replaceRuleRefs = (ast: a.Grammar, from: string, to: string) => {
    const replace = buildVisitor({
      rule_ref: node => {
        if (node.name !== from) {
          return;
        }
        node.name = to;

        const rule = findRule(ast, to);
        if (!rule) {
          throw new Error(`Rule ${to} was not found during proxy removal`);
        }

        session.info(
          `Proxy rule "${from}" replaced by the rule "${to}"`,
          node.location,
          [{
            message: "This rule will be used",
            location: rule.nameLocation,
          }]
        );
      },
    });

    replace(ast);
  };

  const indices: number[] = [];

  ast.rules.forEach((rule, i) => {
    if (rule.type === "rule" && rule.expression.type === "rule_ref") {
      replaceRuleRefs(ast, rule.name, rule.expression.name);
      if (options.allowedStartRules.indexOf(rule.name) === -1) {
        indices.push(i);
      }
    }
  });

  for (const i of indices.reverse()) {
    ast.rules.splice(i, 1);
  }
}