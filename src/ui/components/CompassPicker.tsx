import { DIRECTIONS, directionInfo, type Direction } from '../../core/directions';

/** 3×3 compass of direction buttons (N at the top, S at the bottom). */
export function CompassPicker(props: {
  value: Direction;
  onChange: (d: Direction) => void;
  label: string;
  testIdPrefix?: string;
}) {
  const cells: Array<Direction | null> = Array(9).fill(null);
  for (const d of DIRECTIONS) {
    const { col, row } = directionInfo(d).compass;
    cells[row * 3 + col] = d;
  }
  return (
    <div className="compass-picker" role="radiogroup" aria-label={props.label}>
      {cells.map((d, i) =>
        d ? (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={props.value === d}
            title={`${directionInfo(d).name} — ${directionInfo(d).view}`}
            onClick={() => props.onChange(d)}
            data-testid={props.testIdPrefix ? `${props.testIdPrefix}-${d}` : undefined}
          >
            {d}
          </button>
        ) : (
          <div key={i} className="compass-center">
            facing
            <br />
            {directionInfo(props.value).name.toLowerCase()}
          </div>
        ),
      )}
    </div>
  );
}
