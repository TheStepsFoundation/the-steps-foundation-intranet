import type { EventFeedbackDataset } from './types'
import startingPoint from './starting-point-2025'
import oxbridge from './oxbridge-interview-workshop-2025'
import daMasterclass from './da-masterclass-2026'
import lockIn from './great-lock-in-2026'

export const eventFeedbackByEventId: Record<string, EventFeedbackDataset> = {
  'e1467ac9-6742-48b2-aafc-81ab58a31ea0': startingPoint,
  '303a13ff-b33a-41d5-bdd0-8e5b5538b5a3': oxbridge,
  'd29dc7cf-2336-44ee-994e-9a917bc837d3': daMasterclass,
  'dbcaf8b1-8bb0-4e09-8c73-43f1b75c7094': lockIn,
}

export const eventFeedbackBySlug: Record<string, EventFeedbackDataset> = {
  'starting-point-2025': startingPoint,
  'oxbridge-interview-workshop-2025': oxbridge,
  'da-masterclass-2026': daMasterclass,
  'great-lock-in-2026': lockIn,
}

export type { EventFeedbackDataset } from './types'
