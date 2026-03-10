// globals.d.ts
import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "copy-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { value?: string },
        HTMLElement
      >;
    }
  }
}
