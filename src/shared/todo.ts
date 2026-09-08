// Copy both sides render: the server for the first paint, the component when
// the count changes. One function so they can't disagree on the wording.
export const remainingLabel = (count: number): string =>
  count === 1 ? "1 item left" : `${count} items left`;
