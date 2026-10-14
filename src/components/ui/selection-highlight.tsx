import { motion, useReducedMotion } from "motion/react";

// DogSC's macOS control spring: response 0.22 s, damping fraction 0.72.
export const controlSpring = { type: "spring", stiffness: 815, damping: 41, mass: 1 } as const;
export const panelSpring = { type: "spring", stiffness: 273, damping: 27, mass: 1 } as const;

export function SelectionHighlight({ id }: { id: string }) {
	const reducedMotion = useReducedMotion();
	return (
		<motion.span
			aria-hidden="true"
			className="selection-highlight"
			layoutId={reducedMotion ? undefined : id}
			transition={reducedMotion ? { duration: 0 } : controlSpring}
		/>
	);
}
