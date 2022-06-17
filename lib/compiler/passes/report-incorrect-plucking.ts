import { buildVisitor } from "../visitor";
import type * as a from '../../parser';
import type { Visitor } from "../../parser";
import type { Pass } from "./pass";

type ActionNodes = a.TopLevelInitializer | a.Initializer | a.Action | a.SemanticPredicate

// Ensure plucking can not be done with an action block
export const reportIncorrectPlucking: Pass = (ast, options, session) => {
  const check: Visitor<[ActionNodes | null], void> = buildVisitor<[ActionNodes | null]>({
    action: node => check(node.expression, node),

    labeled: (node, action: ActionNodes | null) => {
      if (node.pick) {
        if (action) {
          session.error(
            "\"@\" cannot be used with an action block",
            node.labelLocation,
            [{
              message: "Action block location",
              location: action.codeLocation,
            }]
          );
        }
      }

      check(node.expression, null);
    },
  });

  check(ast, null);
}
