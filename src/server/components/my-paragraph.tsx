// Scoped web-component styles (JSX string literal workaround)
const css = `
  p {
    color: white;
    background-color: #666;
    padding: 10px 20px;
  }
`;

// Example of a web-component for those times when you just need scoped client-side code
export const MyParagraph = ({ children }: { children: React.ReactNode }) => (
  <>
    <template id="custom-paragraph">
      <style>{css}</style>

      <p>
        <slot name="my-text">My default text</slot>
      </p>
    </template>

    <my-paragraph>{children}</my-paragraph>
  </>
);
