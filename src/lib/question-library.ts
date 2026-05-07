// ---------------------------------------------------------------------------
// Question library
//
// Canonical reusable application questions for Steps events. Each entry is
// (label, type, options[, helpText, options.placeholder]) so the form builder
// can drop the entry in fully-typed — no admin needs to think "is this a
// ranked dropdown or a regular dropdown?". Saves time across every event.
//
// Per-event tweaks: when admin clicks an entry, the resulting field is a
// plain copy in form_config — editing it doesn't affect the library. To add
// a new library entry, append below.
// ---------------------------------------------------------------------------

import type { FormFieldType } from './events-api'

export type LibraryEntry = {
  /** Stable id used in localStorage favourites; not required to be unique to the form. */
  id: string
  /** Short human-readable name shown in the picker. */
  name: string
  /** Category — used to group entries in the picker. */
  category: 'motivation' | 'experience' | 'preferences' | 'context' | 'logistics'
  /** Field-builder defaults — the admin gets these baked in. */
  field: {
    type: FormFieldType
    label: string
    description?: string
    required?: boolean
    options?: string[]
    placeholder?: string
  }
}

export const QUESTION_LIBRARY: LibraryEntry[] = [
  // ---- Motivation
  {
    id: 'why-applying',
    name: 'Why are you applying?',
    category: 'motivation',
    field: {
      type: 'textarea',
      label: 'Why are you applying to this event?',
      description: 'A few sentences on what draws you to this opportunity.',
      required: true,
    },
  },
  {
    id: 'what-you-hope-to-gain',
    name: 'What you hope to gain',
    category: 'motivation',
    field: {
      type: 'textarea',
      label: 'What do you hope to gain from attending?',
      description: 'Skills, exposure, connections — whatever feels honest.',
      required: true,
    },
  },
  {
    id: 'setback-story',
    name: 'A time you faced a setback',
    category: 'experience',
    field: {
      type: 'textarea',
      label: 'Tell us about a time you faced a setback. How did you respond?',
      description: 'Doesn’t have to be dramatic — just real.',
      required: true,
    },
  },
  {
    id: 'leadership-experience',
    name: 'Leadership experience',
    category: 'experience',
    field: {
      type: 'textarea',
      label: 'Describe a moment when you took initiative or led others.',
      description: 'School, family, sport, a side project — anything counts.',
    },
  },
  // ---- Preferences (ranked / select)
  {
    id: 'division-preference',
    name: 'Division ranking (host-specific)',
    category: 'preferences',
    field: {
      type: 'ranked_dropdown',
      label: 'Rank the divisions you’re most interested in learning about',
      description: 'Drag to reorder. We’ll try to match you with someone from your top division on the day.',
      options: ['Edit these options to match the host’s structure'],
    },
  },
  {
    id: 'career-area-interest',
    name: 'Career-area interest',
    category: 'preferences',
    field: {
      type: 'checkbox_list',
      label: 'Which career areas interest you?',
      description: 'Tick all that apply.',
      options: ['Finance', 'Technology', 'Consulting', 'Law', 'Engineering', 'Medicine', 'Creative industries', 'Public sector', 'Not sure yet'],
    },
  },
  {
    id: 'post-alevel-plan',
    name: 'Post-A-level plan',
    category: 'preferences',
    field: {
      type: 'radio',
      label: 'What’s your post-A-level plan?',
      options: ['University', 'Apprenticeship', 'Gap year', 'Job-seeking', 'Not sure yet'],
      required: true,
    },
  },
  {
    id: 'first-gen-uni',
    name: 'First-generation university',
    category: 'context',
    field: {
      type: 'yes_no',
      label: 'Will you be the first in your immediate family to attend university?',
    },
  },
  // ---- Context
  {
    id: 'household-context',
    name: 'Household context',
    category: 'context',
    field: {
      type: 'textarea',
      label: 'Anything about your household or background you’d like us to know?',
      description: 'Optional. Young carer, care experience, recent disruption — we use this to give you fair weighting.',
    },
  },
  {
    id: 'work-experience-prior',
    name: 'Prior work experience',
    category: 'experience',
    field: {
      type: 'textarea',
      label: 'Any prior work experience, internships, or insight days?',
      description: 'List briefly — we just want a sense of your exposure so far.',
    },
  },
  // ---- Logistics
  {
    id: 'dietary-requirements',
    name: 'Dietary requirements',
    category: 'logistics',
    field: {
      type: 'text',
      label: 'Any dietary requirements?',
      description: 'Allergies, halal/kosher/vegetarian/vegan, anything else.',
      placeholder: 'e.g. vegetarian, peanut allergy',
    },
  },
  {
    id: 'accessibility-needs',
    name: 'Accessibility needs',
    category: 'logistics',
    field: {
      type: 'textarea',
      label: 'Any accessibility needs we should know about?',
      description: 'Mobility, sensory, anything we can plan for.',
    },
  },
  {
    id: 'travel-support',
    name: 'Travel-support need',
    category: 'logistics',
    field: {
      type: 'yes_no',
      label: 'Would you need help covering travel costs to attend?',
    },
  },
]

export const LIBRARY_CATEGORY_LABELS: Record<LibraryEntry['category'], string> = {
  motivation: 'Motivation',
  experience: 'Experience',
  preferences: 'Preferences',
  context: 'Context & background',
  logistics: 'Logistics',
}
