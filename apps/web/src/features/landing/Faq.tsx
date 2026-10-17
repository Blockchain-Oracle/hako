import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { FAQ } from "@/lib/constants/landing";

/** "Common questions": a centred heading and a hairline accordion (Monid). */
export function Faq() {
  return (
    <section className="mx-auto max-w-[760px] px-4 py-24 sm:px-6">
      <h2 className="display text-center text-[clamp(2.2rem,5vw,3.6rem)]">Common questions.</h2>
      <Accordion type="single" collapsible className="mt-12 border-t border-line">
        {FAQ.map((item) => (
          <AccordionItem key={item.q} value={item.q} className="border-b border-line">
            <AccordionTrigger className="py-5 text-left text-[0.9875rem] font-medium hover:no-underline">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="pb-5 text-[0.9375rem] leading-relaxed text-muted-foreground">
              {item.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
