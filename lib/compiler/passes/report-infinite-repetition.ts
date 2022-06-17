import { alwaysConsumesOnSuccess } from "../asts";
import { buildVisitor } from "../visitor";
import type { Pass } from "./pass";

// Reports expressions that don't consume any input inside |*| or |+| in the
// grammar, which prevents infinite loops in the generated parser.
export const reportInfiniteRepetition: Pass = (ast, options, session) => {
  const check = buildVisitor({
    zero_or_more(node) {
      if (!alwaysConsumesOnSuccess(ast, node.expression)) {
        session.error(
          "Possible infinite loop when parsing (repetition used with an expression that may not consume any input)",
          node.location
        );
      }
    },

    one_or_more(node) {
      if (!alwaysConsumesOnSuccess(ast, node.expression)) {
        session.error(
          "Possible infinite loop when parsing (repetition used with an expression that may not consume any input)",
          node.location
        );
      }
    },
  });

  check(ast);
}
