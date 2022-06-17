import { findRule } from "../asts";
import { buildVisitor } from "../visitor";
import type { Pass } from "./pass";

// Checks that all referenced rules exist.
export const reportUndefinedRules: Pass = (ast, options, session) => {
  const check = buildVisitor({
    rule_ref(node) {
      if (!findRule(ast, node.name)) {
        session.error(
          `Rule "${node.name}" is not defined`,
          node.location
        );
      }
    },
  });

  check(ast);
}
