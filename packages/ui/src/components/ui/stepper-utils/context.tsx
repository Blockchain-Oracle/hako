'use client';

// 21st.dev stepper (29815's primitive): the types, the two contexts and their hooks, moved unchanged out of
// stepper.tsx to keep each file under the repo's 400-line limit; stepper.tsx re-exports the hooks under the same names.

import * as React from 'react';
import { createContext, useContext } from 'react';

// Types
export type StepperOrientation = 'horizontal' | 'vertical';
export type StepState = 'active' | 'completed' | 'inactive' | 'loading';
export type StepIndicators = {
  active?: React.ReactNode;
  completed?: React.ReactNode;
  inactive?: React.ReactNode;
  loading?: React.ReactNode;
};

export interface StepperContextValue {
  activeStep: number;
  setActiveStep: (step: number) => void;
  stepsCount: number;
  orientation: StepperOrientation;
  registerTrigger: (node: HTMLButtonElement | null) => void;
  triggerNodes: HTMLButtonElement[];
  focusNext: (currentIdx: number) => void;
  focusPrev: (currentIdx: number) => void;
  focusFirst: () => void;
  focusLast: () => void;
  indicators: StepIndicators;
}

export interface StepItemContextValue {
  step: number;
  state: StepState;
  isDisabled: boolean;
  isLoading: boolean;
}

export const StepperContext = createContext<StepperContextValue | undefined>(undefined);
export const StepItemContext = createContext<StepItemContextValue | undefined>(undefined);

export function useStepper() {
  const ctx = useContext(StepperContext);
  if (!ctx) throw new Error('useStepper must be used within a Stepper');
  return ctx;
}

export function useStepItem() {
  const ctx = useContext(StepItemContext);
  if (!ctx) throw new Error('useStepItem must be used within a StepperItem');
  return ctx;
}
