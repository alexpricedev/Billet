// The client layer as one namespace, so a component reads as its own logic
// with the framework calls prefixed:
//
//   import * as ui from "@client/reactive";
//   import * as server from "@client/reactive/request";
//
//   const count = ui.signal(0);
//   const html = await server.submit(form);
//   ui.bind(server.parse(html));
//
// `request.ts` is deliberately not re-exported here. Talking to the server is
// the one thing a component does that isn't presentation, and giving it its
// own name keeps every such call greppable as `server.`.
export {
  bind,
  defineComponent,
  mount,
  registerComponent,
} from "./component";
export {
  batch,
  computed,
  effect,
  isReadable,
  isSignal,
  type Readable,
  runScope,
  type Signal,
  signal,
} from "./signal";
