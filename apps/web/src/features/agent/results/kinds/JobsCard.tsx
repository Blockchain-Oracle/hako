"use client";

import { Building2, MapPin } from "lucide-react";

import { LIST_PREVIEW } from "../constants";
import { formatMoney, humanize } from "../format";
import { num, pickRecords, pickStr, type Rec, rowKey, str } from "../parse";
import { Empty, ExtLink, Meta, Pill, ShowAll, TimeAgo, usePreview } from "../primitives";

function salaryOf(job: Rec): string | null {
  const text = pickStr(job, "salary", "compensation");
  if (text) return text;
  const min = num(job.salary_min);
  const max = num(job.salary_max);
  const currency = str(job.currency);
  if (min !== null && max !== null) return `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
  if (min !== null) return `from ${formatMoney(min, currency)}`;
  return null;
}

function Job({ job }: { job: Rec }) {
  const company = pickStr(job, "company", "employer", "organization");
  const location = pickStr(job, "location", "locations");
  const remote = job.remote === true;
  const salary = salaryOf(job);
  const posted = job.posted_at ?? job.published ?? job.date;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="min-w-0 text-[0.9375rem] leading-snug font-medium">
          <ExtLink href={job.url ?? job.link} className="text-foreground hover:text-brand">
            {pickStr(job, "title", "role", "name") ?? "Untitled role"}
          </ExtLink>
        </h4>
        {salary && <span className="font-mono text-xs text-foreground">{salary}</span>}
      </div>
      <Meta className="mt-1">
        {company && (
          <span className="inline-flex items-center gap-1 font-medium text-ink-2">
            <Building2 className="size-3" aria-hidden /> {company}
          </span>
        )}
        {location && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden /> {location}
          </span>
        )}
        {remote && <Pill tone="success">Remote</Pill>}
        {str(job.department) && <span>{str(job.department)}</span>}
        {str(posted) && <TimeAgo value={posted} />}
        {str(job.ats) && <span className="font-mono">via {humanize(str(job.ats) ?? "")}</span>}
      </Meta>
    </li>
  );
}

/** Open roles (hako/jobs): title, company, location, remote, posted, link. */
export function JobsCard({ data }: { data: Rec }) {
  const jobs = pickRecords(data, "jobs", "results", "items");
  const { shown, expanded, toggle, total } = usePreview(jobs, LIST_PREVIEW);
  const query = pickStr(data, "query");
  return (
    <div>
      {query && (
        <p className="mb-3 text-[0.8125rem] text-muted-foreground">
          <span className="text-foreground">“{query}”</span> · {jobs.length} {jobs.length === 1 ? "role" : "roles"}
        </p>
      )}
      {jobs.length === 0 ? (
        <Empty>No open roles matched.</Empty>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {shown.map((job, index) => (
              <Job key={rowKey(job, index)} job={job} />
            ))}
          </ol>
          <ShowAll total={total} limit={LIST_PREVIEW} expanded={expanded} onToggle={toggle} noun="roles" />
        </>
      )}
    </div>
  );
}
