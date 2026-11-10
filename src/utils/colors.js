/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const enabled = !process.env.NO_COLOR && (process.stdout?.isTTY ?? true);

function c(code, end = 39) {
  return (str) => (enabled ? `\x1b[${code}m${str}\x1b[${end}m` : String(str));
}

module.exports = {
  bold: c(1, 22),
  dim: c(2, 22),
  italic: c(3, 23),
  underline: c(4, 24),
  red: c(31),
  green: c(32),
  yellow: c(33),
  blue: c(34),
  magenta: c(35),
  cyan: c(36),
  white: c(37),
  gray: c(90)
};
