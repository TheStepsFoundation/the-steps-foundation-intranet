'use client'

/**
 * Gmail-style "select all matching filter" banner.
 *
 * When the user ticks the page header checkbox, it only selects the rows on
 * the current page. This banner appears in that state and offers a one-click
 * action to extend the selection to *every* row matching the current filter
 * (not just the current page) — mirroring Gmail's pattern.
 *
 * The parent owns `selected` / `setSelected`. This component is purely a UI
 * shim that computes whether to show the prompt and calls the extend/clear
 * callbacks. It must live *above* the bulk-action bar so admins see it before
 * they trigger a destructive action on 50 rows when they meant all 400.
 *
 * Parent is responsible for clearing selection when the filter changes — this
 * component intentionally does not own that effect because different surfaces
 * have different "filter" shapes.
 */

type Props = {
  selectedCount: number        // rows currently selected
  pageCount: number            // rows rendered on the current page
  filteredCount: number        // total rows matching the current filter
  allPageSelected: boolean     // every row on the current page is selected
  allFilteredSelected: boolean // every row across the whole filter is selected
  onSelectAllFiltered: () => void
  onClear: () => void
  /** Noun for the rows — e.g. "applicants", "students". */
  noun?: string
}

export default function SelectAllBanner({
  selectedCount,
  pageCount,
  filteredCount,
  allPageSelected,
  allFilteredSelected,
  onSelectAllFiltered,
  onClear,
  noun = 'items',
}: Props) {
  // Two banner states:
  //   1. Promo: page is fully selected but there's more in the filter — offer extend.
  //   2. Confirmed: user extended selection to the full filter — show the state + clear.
  const hasMoreToSelect = allPageSelected && filteredCount > pageCount && !allFilteredSelected
  if (!hasMoreToSelect && !allFilteredSelected) return null

  if (allFilteredSelected) {
    return (
      <div className="px-3 py-2 bg-steps-blue-50 dark:bg-steps-blue-900/20 border-b border-steps-blue-200 dark:border-steps-blue-800 text-xs flex items-center justify-center gap-3">
        <span className="text-steps-blue-800 dark:text-steps-blue-300">
          All <strong className="font-semibold">{filteredCount}</strong> {noun} in this view are selected.
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-steps-blue-700 dark:text-steps-blue-400 underline hover:no-underline font-medium"
        >
          Clear selection
        </button>
      </div>
    )
  }

  return (
    <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-xs flex items-center justify-center gap-3">
      <span className="text-amber-900 dark:text-amber-200">
        All <strong className="font-semibold">{selectedCount}</strong> {noun} on this page are selected.
      </span>
      <button
        type="button"
        onClick={onSelectAllFiltered}
        className="text-steps-blue-700 dark:text-steps-blue-400 underline hover:no-underline font-medium"
      >
        Select all {filteredCount} {noun} matching filter
      </button>
    </div>
  )
}
