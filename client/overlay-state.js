/** Small decision used by the floating composer: clear only when the words
 *  actually went somewhere (a session or the retained draft). A failed say
 *  keeps the original text in the input. */
export function afterOverlaySay(current, result) {
  return result?.delivered === false ? current : '';
}
