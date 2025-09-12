// globals.d.ts
import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "my-paragraph": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
