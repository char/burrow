export const logging = {
  info: (msg: string) => console.log("%c[info]%c %s", "color: cyan", "color: reset", msg),
  warn: (msg: string) => console.log("%c[warn]%c %s", "color: yellow", "color: reset", msg),
};
