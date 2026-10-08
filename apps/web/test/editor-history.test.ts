import { describe, expect, it } from 'vitest';
import { EditorHistory, type EditorSnapshot } from '../lib/editor-history';

const state = (text: string, anchor = text.length, head = anchor): EditorSnapshot => ({ text, selection: { anchor, head } });
describe('editor history', () => {
  it('groups adjacent typing, preserves selections, and supports redo', () => {
    const history = new EditorHistory('');
    history.record(state(''), state('a'), 'insertText', 0);
    history.record(state('a'), state('ab'), 'insertText', 100);
    history.record(state('ab'), state('abc'), 'insertText', 200);
    expect(history.undo({ anchor: 1, head: 3 })).toEqual(state(''));
    expect(history.redo({ anchor: 0, head: 0 })).toEqual(state('abc', 1, 3));
  });
  it('separates paste/format commands and replacement selections from typing', () => {
    const history = new EditorHistory('hello');
    history.record(state('hello', 5, 0), state('**hello**'), 'command', 0);
    history.record(state('**hello**'), state('**hello**\nhttps://example.com'), 'paste', 10);
    expect(history.undo(state('').selection)).toEqual(state('**hello**'));
    expect(history.undo(state('').selection)).toEqual(state('hello', 5, 0));
    history.record(state('hello', 5, 0), state('new'), 'insertText', 20);
    expect(history.redo(state('new').selection)).toBeNull();
  });
  it('starts a new step after a pause or caret navigation, and resets after a submit', () => {
    const history = new EditorHistory('');
    history.record(state(''), state('one'), 'insertText', 0);
    history.record(state('one'), state('one two'), 'insertText', 1000);
    history.breakGroup();
    history.record(state('one two'), state('one two!'), 'insertText', 1100);
    expect(history.undo(state('one two!').selection)?.text).toBe('one two');
    expect(history.undo(state('one two').selection)?.text).toBe('one');
    history.reset('');
    expect(history.undo(state('').selection)).toBeNull();
    expect(history.redo(state('').selection)).toBeNull();
  });
});
