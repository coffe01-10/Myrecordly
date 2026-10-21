import { Accordion as HeroAccordion } from "@heroui/react";
import type { ComponentProps } from "react";
export const Accordion = HeroAccordion;
export const AccordionItem = HeroAccordion.Item;
export function AccordionTrigger({
	children,
	...props
}: Omit<ComponentProps<typeof HeroAccordion.Trigger>, "children"> & {
	children?: import("react").ReactNode;
}) {
	return (
		<HeroAccordion.Heading>
			<HeroAccordion.Trigger {...props}>
				{children}
				<HeroAccordion.Indicator />
			</HeroAccordion.Trigger>
		</HeroAccordion.Heading>
	);
}
export function AccordionContent({
	children,
	bodyClassName,
	...props
}: ComponentProps<typeof HeroAccordion.Panel> & { bodyClassName?: string }) {
	return (
		<HeroAccordion.Panel {...props}>
			<HeroAccordion.Body className={bodyClassName}>{children}</HeroAccordion.Body>
		</HeroAccordion.Panel>
	);
}
