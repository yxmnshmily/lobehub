import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { focusEditorOnBodyClick } from './focusEditorOnBodyClick';

function Input() {
  return (
    <div onClick={focusEditorOnBodyClick}>
      <div contentEditable suppressContentEditableWarning role="textbox">
        测试文字
      </div>
      <div data-testid="blank" />
      <button>附件</button>
    </div>
  );
}

it('focuses the editor when clicking the surrounding blank input area', () => {
  render(<Input />);
  fireEvent.click(screen.getByTestId('blank'));
  expect(screen.getByRole('textbox')).toHaveFocus();
});

it('does not steal focus from controls or move an existing text selection', () => {
  render(<Input />);
  const button = screen.getByRole('button');
  button.focus();
  fireEvent.click(button);
  expect(button).toHaveFocus();
  const editor = screen.getByRole('textbox');
  editor.focus();
  const range = document.createRange();
  range.setStart(editor.firstChild!, 1);
  range.setEnd(editor.firstChild!, 3);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.click(editor);
  expect(window.getSelection()!.toString()).toBe('试文');
});
