// The entry page as the browser gets it before the program runs (contract §0 rule 12): the message a failing program
// file leaves, and the touch behavior of the canvas and the page. Node cannot compute sizes from the stylesheet;
// the layout is checked in a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom } from './fakes/dom.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const FAILED = 'DEEPWAKE could not load its program files. Serve its folder with a local web server; README.md tells how.';

/** The inline handler of the page, run on a fresh fake page; `messages` lists the fatal paragraphs of the body. */
function runHandler() {
  const at = html.indexOf('<script>');
  const end = html.indexOf('</script>', at);
  assert.ok(at >= 0 && at < html.indexOf('<script type="module"'), 'the handler is inline and comes before the program');
  const page = installDom();
  new Function(html.slice(at + '<script>'.length, end))();
  const messages = () => page.document.body.querySelectorAll('.fatal').map((node) => [node.tagName, node.className, node.textContent]);
  return { ...page, messages };
}

test('Entry: a program file that fails to load or to run leaves one message in the fatal style', () => {
  const { window, document, messages } = runHandler();
  assert.deepEqual(messages(), []);
  // Another resource that fails is not the program.
  const sheet = document.createElement('link');
  document.body.append(sheet);
  sheet.dispatch('error');
  assert.deepEqual(messages(), []);
  // The module script, or a module it imports, could not be fetched: the error of the script element reaches the window.
  const script = document.createElement('script');
  script.setAttribute('type', 'module');
  document.body.append(script);
  script.dispatch('error');
  assert.deepEqual(messages(), [['P', 'fatal', FAILED]]);
  // Whatever error follows, a second one among them, adds nothing.
  window.dispatch('error');
  assert.deepEqual(messages(), [['P', 'fatal', FAILED]]);
});

test('Entry: an exception while the program starts leaves the message', () => {
  const { window, messages } = runHandler();
  window.dispatch('error');
  assert.deepEqual(messages(), [['P', 'fatal', FAILED]]);
});

test('Entry: the handler stops once the page has loaded, so a running game reports its own errors', () => {
  const { window, document, messages } = runHandler();
  document.dispatch('DOMContentLoaded');
  window.dispatch('error');
  assert.deepEqual(messages(), []);
});

test('Entry: the canvas and the page take no touch scrolling or zooming', () => {
  const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf('}', at));
  };
  assert.match(rule('#game'), /touch-action: none/);
  assert.match(rule('html,\nbody'), /touch-action: none/);
  assert.ok(css.includes('.fatal {'), 'the message has its style');
});
