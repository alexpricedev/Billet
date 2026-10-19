# Release note (for the release PR): self-host Lottie (#109)

Breaking changes: none for the app. Forks that edited the unpkg `<script>` tag in
`layouts.tsx`, or added their own origins to `script-src`, should re-apply on top
of the new tag. Production builds now need `dist/assets/lottie.js`: custom build
commands must run `bun run build` (which includes `build:vendor`), or boot throws.
