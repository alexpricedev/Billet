const css = `
  :host {
    display: inline-block;
  }

  button {
    cursor: pointer;
    background: none;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    line-height: 1rem;
    color: #6b7280;
    transition: all 150ms ease;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  button:hover {
    border-color: #9ca3af;
    color: #374151;
  }

  button.copied {
    border-color: #86efac;
    color: #16a34a;
  }

  .icon {
    width: 14px;
    height: 14px;
  }

  .label-copy,
  .label-copied {
    pointer-events: none;
  }

  .label-copied { display: none; }

  button.copied .label-copy { display: none; }
  button.copied .label-copied { display: inline; }
`;

const CopyIcon = () => (
  <svg
    className="icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x={9} y={9} width={13} height={13} rx={2} ry={2} />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg
    className="icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const CopyButtonTemplate = () => (
  <template id="copy-button-template">
    <style>{css}</style>
    <button type="button" aria-label="Copy to clipboard">
      <span className="label-copy">
        <CopyIcon />
      </span>
      <span className="label-copy">Copy</span>
      <span className="label-copied">
        <CheckIcon />
      </span>
      <span className="label-copied">Copied!</span>
    </button>
  </template>
);

export const CopyButton = ({ value }: { value: string }) => (
  <copy-button value={value} />
);
