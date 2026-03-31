'use client'

import { useState } from 'react'
import type { Intensity } from '@/lib/database.types'
import { INTENSITY_OPTIONS } from './types'

// Inline SVG icons
const ClockIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const XIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

interface SubtaskCompletionModalProps {
  subtaskDescription: string
  predictedIntensity: Intensity
  onConfirm: (actualHours: number, newIntensity: Intensity) => void
  onCancel: () => void
}

const HOUR_OPTIONS = [
  { value: 0.33, label: '20 min' },
  { value: 1, label: '1 hr' },
  { value: 2, label: '2 hrs' },
  { value: 3, label: '3 hrs' },
  { value: 4, label: '4 hrs' },
  { value: 5, label: '5 hrs' },
  { value: 6, label: '6 hrs' },
  { value: 8, label: '8 hrs' },
]

// Map actual hours to closest intensity bracket
function hoursToIntensity(hours: number): Intensity {
  if (hours <= 0.5) return 'quick'
  if (hours <= 1.5) return 'small'
  if (hours <= 4) return 'medium'
  if (hours <= 7) return 'large'
  return 'huge'
}

export function SubtaskCompletionModal({
  subtaskDescription,
  predictedIntensity,
  onConfirm,
  onCancel,
}: SubtaskCompletionModalProps) {
  const [selectedHours, setSelectedHours] = useState<number | null>(null)
  const [customHours, setCustomHours] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const predictedHours = INTENSITY_OPTIONS.find(o => o.value === predictedIntensity)?.hours || 1

  const handleConfirm = () => {
    const hours = showCustom ? parseFloat(customHours) : selectedHours
    if (hours && hours > 0) {
      const newIntensity = hoursToIntensity(hours)
      onConfirm(hours, newIntensity)
    }
  }

  const isValid = showCustom 
    ? customHours && parseFloat(customHours) > 0 
    : selectedHours !== null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2 text-purple-600">
            <ClockIcon />
            <h2 className="text-lg font-semibold text-gray-900">How long did it take?</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-gray-100 rounded-lg transition text-gray-500"
          >
            <XIcon />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Subtask info */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">Completing:</p>
            <p className="font-medium text-gray-900">{subtaskDescription || 'Untitled subtask'}</p>
            <p className="text-xs text-gray-500 mt-1">
              Predicted: ~{predictedHours}h ({predictedIntensity})
            </p>
          </div>

          {/* Hour selection */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {HOUR_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => {
                  setSelectedHours(opt.value)
                  setShowCustom(false)
                }}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                  selectedHours === opt.value && !showCustom
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom input */}
          <div className="mb-4">
            <button
              onClick={() => {
                setShowCustom(!showCustom)
                setSelectedHours(null)
              }}
              className={`text-sm font-medium transition ${
                showCustom ? 'text-purple-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {showCustom ? '← Back to presets' : 'Enter custom hours →'}
            </button>
            
            {showCustom && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="24"
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value)}
                  placeholder="e.g. 2.5"
                  className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  autoFocus
                />
                <span className="text-sm text-gray-500">hours</span>
              </div>
            )}
          </div>

          {/* Preview intensity change */}
          {isValid && (
            <div className="mb-4 p-3 bg-purple-50 rounded-lg">
              <p className="text-sm text-purple-700">
                {(() => {
                  const hours = showCustom ? parseFloat(customHours) : selectedHours!
                  const newIntensity = hoursToIntensity(hours)
                  if (newIntensity !== predictedIntensity) {
                    return `Intensity will update: ${predictedIntensity} → ${newIntensity}`
                  }
                  return `Intensity stays: ${predictedIntensity}`
                })()}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Mark Complete
          </button>
        </div>
      </div>
    </div>
  )
}
