import { LocationRange } from "../../parser";
import { buildVisitor } from "../visitor";
import type { Pass } from "./pass";

// Checks that each rule is defined only once.
export const reportDuplicateRules: Pass = (ast, options, session) => {
  const rules: Record<string, LocationRange> = {};

  const check = buildVisitor({
    rule: node => {
      if (Object.prototype.hasOwnProperty.call(rules, node.name)) {
        session.error(
          `Rule "${node.name}" is already defined`,
          node.nameLocation,
          [{
            message: "Original rule location",
            location: rules[node.name],
          }]
        );
      } else {
        rules[node.name] = node.nameLocation;
      }
    },
  });

  check(ast);
}
