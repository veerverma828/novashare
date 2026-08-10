import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomCodeFlap } from './components/RoomCodeFlap';
import { SwipeableFileRow } from './components/SwipeableFileRow';
import { FolderQueueRow } from './components/FolderQueueRow';
import { AppIcon } from './components/AppIcon';
import { HighlightMatch } from './components/HighlightMatch';
import { TransferRing } from './components/TransferRing';

describe('RoomCodeFlap', () => {
  it('renders one flap per character of a 6-char code', () => {
    const { container } = render(<RoomCodeFlap code="AB12CD" />);
    const flaps = container.querySelectorAll('span');
    expect(flaps).toHaveLength(6);
    const text = Array.from(flaps).map((f) => f.textContent).join('');
    // Characters scramble over time, but the initial render should show
    // the actual code before any interval ticks occur.
    expect(text).toBe('AB12CD');
  });
});

describe('SwipeableFileRow', () => {
  const file = { name: 'photo.png', size: 12345 };

  it('renders the file name and size label', () => {
    render(<SwipeableFileRow file={file} sizeLabel="12 KB" onRemove={() => {}} />);
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('12 KB')).toBeInTheDocument();
  });

  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<SwipeableFileRow file={file} sizeLabel="12 KB" onRemove={onRemove} />);
    await user.click(screen.getByLabelText('Remove photo.png'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('calls onRemove when dragged past the removal threshold and released', () => {
    const onRemove = vi.fn();
    const { container } = render(<SwipeableFileRow file={file} sizeLabel="12 KB" onRemove={onRemove} />);
    const row = container.firstChild;
    fireEvent.pointerDown(row, { clientX: 200 });
    fireEvent.pointerMove(row, { clientX: 100 }); // delta -100, past -72 threshold
    fireEvent.pointerUp(row);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('FolderQueueRow', () => {
  const entries = [
    { file: { name: 'a.txt', size: 100 }, index: 0 },
    { file: { name: 'b.txt', size: 200 }, index: 1 }
  ];
  const formatBytes = (n) => `${n}B`;

  it('renders folder name and entry count/size', () => {
    render(
      <FolderQueueRow
        name="myFolder"
        entries={entries}
        formatBytes={formatBytes}
        onRemoveAll={() => {}}
        onRemoveOne={() => {}}
      />
    );
    expect(screen.getByText('myFolder')).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
    expect(screen.getByText(/300B/)).toBeInTheDocument();
  });

  it('calls onRemoveAll when the folder remove button is clicked', async () => {
    const onRemoveAll = vi.fn();
    const user = userEvent.setup();
    render(
      <FolderQueueRow
        name="myFolder"
        entries={entries}
        formatBytes={formatBytes}
        onRemoveAll={onRemoveAll}
        onRemoveOne={() => {}}
      />
    );
    await user.click(screen.getByLabelText('Remove folder myFolder'));
    expect(onRemoveAll).toHaveBeenCalledTimes(1);
  });

  it('calls onRemoveOne with the entry index when a single entry is removed', async () => {
    const onRemoveOne = vi.fn();
    const user = userEvent.setup();
    render(
      <FolderQueueRow
        name="myFolder"
        entries={entries}
        formatBytes={formatBytes}
        onRemoveAll={() => {}}
        onRemoveOne={onRemoveOne}
      />
    );
    // Expand the folder to reveal per-file rows.
    await user.click(screen.getByText('myFolder'));
    await user.click(screen.getByLabelText('Remove b.txt'));
    expect(onRemoveOne).toHaveBeenCalledWith(1);
  });
});

describe('AppIcon', () => {
  it('renders a fallback placeholder without crashing when the icon is null', () => {
    const { container } = render(<AppIcon packageName="com.example.app" />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    // Fallback container should still render something visible.
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe('HighlightMatch', () => {
  it('wraps the matching substring in a <mark>, case-insensitively', () => {
    const { container } = render(<div>{HighlightMatch({ text: 'HelloWorld', query: 'world' })}</div>);
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark.textContent).toBe('World');
    expect(container.textContent).toBe('HelloWorld');
  });

  it('renders plain text with no highlighting when query is empty', () => {
    const { container } = render(<div>{HighlightMatch({ text: 'HelloWorld', query: '' })}</div>);
    expect(container.querySelector('mark')).not.toBeInTheDocument();
    expect(container.textContent).toBe('HelloWorld');
  });

  it('renders plain text when query does not match anything', () => {
    const { container } = render(<div>{HighlightMatch({ text: 'HelloWorld', query: 'xyz' })}</div>);
    expect(container.querySelector('mark')).not.toBeInTheDocument();
    expect(container.textContent).toBe('HelloWorld');
  });
});

describe('TransferRing', () => {
  function getProgressCircle(container) {
    // Second <circle> is the progress indicator (first is the track).
    return container.querySelectorAll('circle')[1];
  }

  it('has full offset (no progress) at 0%', () => {
    const { container } = render(<TransferRing progress={0} />);
    const circumference = 2 * Math.PI * 52;
    const circle = getProgressCircle(container);
    expect(Number(circle.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference);
  });

  it('has half offset at 50%', () => {
    const { container } = render(<TransferRing progress={50} />);
    const circumference = 2 * Math.PI * 52;
    const circle = getProgressCircle(container);
    expect(Number(circle.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference / 2);
  });

  it('has zero offset (full ring) at 100%', () => {
    const { container } = render(<TransferRing progress={100} />);
    const circle = getProgressCircle(container);
    expect(Number(circle.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
  });

  it('renders the rounded percentage label', () => {
    render(<TransferRing progress={42.6} />);
    expect(screen.getByText('43%')).toBeInTheDocument();
  });
});
