/// <reference types="vite/client" />

// The kit ships one global sheet; we pull it as a string and inject it at mount.
declare module '*.css?inline' {
  const css: string
  export default css
}
