import { useId, useState, type ReactNode } from 'react';

import type {
  InspectorAction,
  InspectorField,
  InspectorSection,
  InspectorValue,
} from '../native/inspector';

interface ControlsProps {
  onChange: (id: string, value: InspectorValue) => void;
  onAction: (id: string) => void;
}

/** A disclosure is independent from enablement: inspecting a disabled effect never turns it on. */
export function InspectorStackCard({
  title,
  enabled,
  onToggle,
  actions,
  children,
  initiallyExpanded = false,
}: {
  title: string;
  enabled: boolean;
  onToggle: () => void;
  actions: ReactNode;
  children: ReactNode;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const bodyId = useId();
  return (
    <li className={`inspector-stack-card${enabled ? '' : ' is-disabled'}`}>
      <div className="inspector-stack-header">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          aria-label={`Enable ${title}`}
        />
        <button
          className="inspector-stack-disclosure"
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="disclosure-chevron" aria-hidden="true">
            {expanded ? '⌄' : '›'}
          </span>
          <span className="inspector-stack-title">{title}</span>
        </button>
        <span className="inspector-stack-actions">{actions}</span>
      </div>
      <div className="inspector-stack-body" id={bodyId} hidden={!expanded}>
        {children}
      </div>
    </li>
  );
}

export function InspectorFields({
  fields,
  actions,
  onChange,
  onAction,
}: ControlsProps & {
  fields: InspectorField[];
  actions?: InspectorAction[];
}) {
  return (
    <div className="metadata-fields">
      {fields.map((field) => (
        <InspectorFieldControl
          key={field.id}
          field={field}
          onChange={onChange}
        />
      ))}
      {actions?.map((action) => (
        <button
          className="metadata-action"
          key={action.id}
          type="button"
          onClick={() => onAction(action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function InspectorSectionControls({
  section,
  onChange,
  onAction,
}: ControlsProps & { section: InspectorSection }) {
  return (
    <>
      <InspectorFields
        fields={section.fields}
        actions={section.actions}
        onChange={onChange}
        onAction={onAction}
      />
      {section.children?.map((child) => (
        <details className="metadata-section" key={child.id}>
          <summary>{child.label}</summary>
          {child.description && (
            <p className="foundation-note">{child.description}</p>
          )}
          <InspectorSectionControls
            section={child}
            onChange={onChange}
            onAction={onAction}
          />
        </details>
      ))}
    </>
  );
}

function InspectorFieldControl({
  field,
  onChange,
}: Pick<ControlsProps, 'onChange'> & { field: InspectorField }) {
  const id = useId();
  const change = (value: InspectorValue) => onChange(field.id, value);
  if (field.type === 'boolean')
    return (
      <label className="metadata-field metadata-checkbox">
        <input
          type="checkbox"
          checked={Boolean(field.value)}
          onChange={(event) => change(event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  if (field.type === 'color') {
    const value = field.value as number[];
    const hex = `#${value
      .slice(0, 3)
      .map((channel) =>
        Math.round(channel * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
    return (
      <div className="metadata-field metadata-color">
        <label htmlFor={id}>{field.label}</label>
        <input
          id={id}
          type="color"
          value={hex}
          onChange={(event) => {
            const rgb = event.target.value
              .slice(1)
              .match(/../g)!
              .map((channel) => parseInt(channel, 16) / 255);
            change([...rgb, value[3]!]);
          }}
        />
        <label className="metadata-alpha">
          <span>Alpha</span>
          <InspectorNumberInput
            min={0}
            max={1}
            step={0.01}
            aria-label={`${field.label} alpha`}
            value={value[3]!}
            onChange={(alpha) => change([...value.slice(0, 3), alpha])}
          />
        </label>
      </div>
    );
  }
  if (field.type === 'curve')
    return <CurveControl field={field} onChange={change} />;
  return (
    <label
      className={`metadata-field${field.multiline ? ' metadata-multiline' : ''}`}
    >
      <span>{field.label}</span>
      {field.type === 'choice' ? (
        <select
          aria-label={field.label}
          value={String(field.value)}
          onChange={(event) => {
            const option = field.options?.find(
              (candidate) => String(candidate.value) === event.target.value,
            );
            if (option) change(option.value);
          }}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === 'number' ? (
        <InspectorNumberInput
          value={field.value as number}
          min={field.min}
          max={field.max}
          step={field.step}
          integer={field.integer}
          onChange={change}
        />
      ) : field.multiline ? (
        <textarea
          value={String(field.value)}
          maxLength={field.maxLength}
          rows={3}
          onChange={(event) => change(event.target.value)}
        />
      ) : (
        <input
          type="text"
          value={String(field.value)}
          maxLength={field.maxLength}
          onChange={(event) => change(event.target.value)}
        />
      )}
    </label>
  );
}

/** Keep a minus sign, decimal point or temporarily empty field while an exact value is typed. */
function InspectorNumberInput({
  value,
  onChange,
  min,
  max,
  step,
  integer,
  'aria-label': label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState({ source: value, text: String(value) });
  // Changes from undo, another control or a different curve point replace the local draft.
  // Adjusting during render avoids a stale value being painted for one frame.
  if (draft.source !== value) setDraft({ source: value, text: String(value) });
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={integer ? 1 : (step ?? 'any')}
      aria-label={label}
      value={draft.text}
      onChange={(event) => {
        const text = event.target.value;
        const number = Number(text);
        // Step describes useful increments for the arrow controls, not precision limits.
        const valid =
          text !== '' &&
          Number.isFinite(number) &&
          (min === undefined || number >= min) &&
          (max === undefined || number <= max) &&
          (!integer || Number.isInteger(number));
        const next = valid ? number : value;
        setDraft({ source: next, text });
        if (valid) onChange(next);
      }}
      onBlur={() => setDraft({ source: value, text: String(value) })}
    />
  );
}

function CurveControl({
  field,
  onChange,
}: {
  field: InspectorField;
  onChange: (value: number[]) => void;
}) {
  const values = field.value as number[];
  const [pointIndex, setPointIndex] = useState(0);
  const index = Math.min(pointIndex, values.length - 1);
  return (
    <fieldset className="metadata-curve">
      <legend>{field.label}</legend>
      <svg viewBox="0 0 180 64" role="img" aria-label={`${field.label} curve`}>
        <path
          d={`M ${values.map((value, point) => `${(point * 180) / Math.max(1, values.length - 1)},${64 - value * 64}`).join(' L ')}`}
        />
        <circle
          cx={(index * 180) / Math.max(1, values.length - 1)}
          cy={64 - values[index]! * 64}
          r="3"
        />
      </svg>
      <label className="metadata-field">
        <span>Control point</span>
        <select
          aria-label={`${field.label} control point`}
          value={index}
          onChange={(event) => setPointIndex(Number(event.target.value))}
        >
          {values.map((_, point) => (
            <option key={point} value={point}>
              {point + 1}
            </option>
          ))}
        </select>
      </label>
      <label className="metadata-field">
        <span>Value</span>
        <InspectorNumberInput
          aria-label={`${field.label} value`}
          min={0}
          max={1}
          step={0.01}
          value={values[index]!}
          onChange={(value) => {
            const next = [...values];
            next[index] = value;
            onChange(next);
          }}
        />
      </label>
    </fieldset>
  );
}
