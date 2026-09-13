// Side-effect CSS imports (`import './X.css'`) — the bundler injects the stylesheet; TS only needs
// to know the specifier resolves. The launcher's design slice imports its component CSS this way.
declare module '*.css'
