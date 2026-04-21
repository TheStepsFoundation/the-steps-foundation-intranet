'use client'

import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export type ColumnPickerItem = {
  id: string
  label: string
  group?: string          // optional grouping label (e.g. "Standard", "Form answers")
  disabled?: boolean      // render but not togglable (e.g. auto-hidden by a filter)
  disabledReason?: string // tooltip text for disabled rows
}

type Props = {
  /** All candidate columns in their canonical default order. */
  allColumns: ColumnPickerItem[]
  /** Column ids currently hidden. */
  hidden: Set<string>
  /** Current display order — empty/null means use the canonical allColumns order. */
  order: string[]
  /** Toggle visibility for a single column. */
  onToggle: (id: string) => void
  /** Commit a new order (full array of ids in display order). */
  onReorder: (newOrder: string[]) => void
  /** Clear all customisation back to canonical defaults. */
  onReset: () => void
  /** Optional: show a count "X of Y visible" in the button label. */
  buttonLabel?: string
}

/**
 * Dropdown column picker with:
 *   - tickbox per column (click row to toggle)
 *   - drag-to-reorder via @dnd-kit
 *   - Reset-to-default link
 * Commits each toggle/reorder via the onChange callbacks so the parent can
 * persist server-side without needing to wait for the popover to close.
 */
export default function ColumnPicker({
  allColumns,
  hidden,
  order,
  onToggle,
  onReorder,
  onReset,
  buttonLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Resolve visible order: honour `order` if non-empty, else canonical.
  const resolvedOrder: string[] = (() => {
    if (order.length === 0) return allColumns.map(c => c.id)
    const map = new Map(allColumns.map(c => [c.id, c]))
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of order) {
      if (map.has(id) && !seen.has(id)) { seen.add(id); out.push(id) }
    }
    for (const c of allColumns) if (!seen.has(c.id)) out.push(c.id)
    return out
  })()

  const orderedItems = resolvedOrder
    .map(id => allColumns.find(c => c.id === id))
    .filter((c): c is ColumnPickerItem => c !== undefined)

  const visibleCount = orderedItems.filter(c => !hidden.has(c.id)).length
  const totalCount = orderedItems.length

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (rootRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = resolvedOrder.indexOf(String(active.id))
    const newIdx = resolvedOrder.indexOf(String(over.id))
    if (oldIdx < 0 || newIdx < 0) return
    onReorder(arrayMove(resolvedOrder, oldIdx, newIdx))
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
        <span>{buttonLabel ?? 'Columns'}</span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">({visibleCount}/{totalCount})</span>
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-72 max-h-[70vh] flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg z-40">
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">Columns</span>
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-steps-blue-600 dark:text-steps-blue-400 hover:underline"
            >
              Reset to defaults
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={resolvedOrder} strategy={verticalListSortingStrategy}>
                {orderedItems.map(col => (
                  <SortableRow
                    key={col.id}
                    id={col.id}
                    label={col.label}
                    group={col.group}
                    checked={!hidden.has(col.id)}
                    disabled={col.disabled}
                    disabledReason={col.disabledReason}
                    onToggle={() => !col.disabled && onToggle(col.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 text-[11px] text-gray-500 dark:text-gray-400">
            Drag the handle to reorder. Click a row to toggle visibility.
          </div>
        </div>
      )}
    </div>
  )
}

function SortableRow({
  id, label, group, checked, disabled, disabledReason, onToggle,
}: {
  id: string
  label: string
  group?: string
  checked: boolean
  disabled?: boolean
  disabledReason?: string
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-2 py-1.5 mx-1 rounded-md ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
      title={disabled ? disabledReason : undefined}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-grab active:cursor-grabbing p-0.5"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 8 14">
          <circle cx="2" cy="2" r="1.1" /><circle cx="6" cy="2" r="1.1" />
          <circle cx="2" cy="7" r="1.1" /><circle cx="6" cy="7" r="1.1" />
          <circle cx="2" cy="12" r="1.1" /><circle cx="6" cy="12" r="1.1" />
        </svg>
      </button>

      {/* Checkbox + label (single clickable row) */}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex-1 flex items-center gap-2 text-left text-sm text-gray-800 dark:text-gray-200 min-w-0"
      >
        <span
          aria-hidden
          className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
            checked
              ? 'bg-steps-blue-600 border-steps-blue-600'
              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
          }`}
        >
          {checked && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
        <span className="truncate">{label}</span>
        {group && <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">{group}</span>}
      </button>
    </div>
  )
}
