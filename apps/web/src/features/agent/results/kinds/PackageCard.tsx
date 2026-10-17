"use client";

import { cn } from "@/lib/utils";

import { CHIPS_PREVIEW, RELEASE_NOTES_CLAMP_CHARS, RELEASES_PREVIEW } from "../constants";
import { formatCount, humanize } from "../format";
import { Markdown } from "../Markdown";
import { hostOf, num, pickStr, type Rec, rec, records, rowKey, safeHref, str, strings } from "../parse";
import { ExtLink, Meta, Notice, Pill, Section, ShowAll, Stat, TimeAgo, usePreview } from "../primitives";

const OSV_URL = "https://osv.dev/vulnerability/";

// Single-URL fields every registry spells differently, with the label each one gets.
const LINK_FIELDS: Array<[key: string, label: string | null]> = [
  ["homepage", "Homepage"],
  ["repository", "Repository"],
  ["npm_url", "npm"],
  ["pypi_url", "PyPI"],
  ["url", null], // the record's own page: labelled by its host (github.com, deps.dev)
];

function linksOf(data: Rec): Array<[string, string]> {
  const out = new Map<string, string>();
  const add = (label: string, href: unknown) => {
    const safe = safeHref(href);
    if (!safe || [...out.values()].includes(safe)) return;
    out.set(out.has(label) ? `${label} ${out.size + 1}` : label, safe);
  };
  LINK_FIELDS.forEach(([key, label]) => add(label ?? hostOf(data[key]) ?? "Page", data[key]));
  Object.entries(rec(data.project_urls)).forEach(([label, href]) => add(label, href));
  records(data.links).forEach((link) => add(humanize(pickStr(link, "label") ?? "link"), link.url));
  return [...out.entries()];
}

/** deps.dev lists one project once per relation (source repo, issue tracker): one row per project here. */
function relatedOf(data: Rec): Array<[string, string[]]> {
  const byId = new Map<string, string[]>();
  records(data.related_projects).forEach((project) => {
    const id = str(project.id);
    if (!id) return;
    const relation = str(project.relation);
    byId.set(id, [...(byId.get(id) ?? []), ...(relation ? [relation] : [])]);
  });
  return [...byId.entries()];
}

function Notices({ data }: { data: Rec }) {
  const notes: string[] = [];
  const deprecated = data.deprecated;
  if (typeof deprecated === "string" && deprecated.trim()) notes.push(`Deprecated: ${deprecated.trim()}`);
  else if (deprecated === true) notes.push("Deprecated.");
  if (str(data.deprecated_reason)) notes.push(`This version is deprecated: ${str(data.deprecated_reason)}`);
  if (data.yanked === true) notes.push(`Yanked from the index${str(data.yanked_reason) ? `: ${str(data.yanked_reason)}` : "."}`);
  if (data.archived === true) notes.push("Archived: the repository is read-only and no longer maintained.");
  return (
    <>
      {notes.map((note) => (
        <Notice key={note} className="mt-3">
          {note}
        </Notice>
      ))}
    </>
  );
}

function Releases({ versions }: { versions: Rec[] }) {
  const { shown, expanded, toggle, total } = usePreview(versions, RELEASES_PREVIEW);
  return (
    <Section label="Recent versions">
      <ul className="divide-y divide-line text-[0.8125rem]">
        {shown.map((v, index) => (
          <li key={rowKey(v, index, "version")} className="flex items-baseline justify-between gap-3 py-1">
            <span className="font-mono text-foreground">
              {pickStr(v, "version", "tag", "name") ?? "—"}
              {v.deprecated === true && <Pill className="ml-2">deprecated</Pill>}
            </span>
            {str(v.published_at) && <TimeAgo value={v.published_at} className="text-xs text-muted-foreground" />}
          </li>
        ))}
      </ul>
      <ShowAll total={total} limit={RELEASES_PREVIEW} expanded={expanded} onToggle={toggle} noun="versions" />
    </Section>
  );
}

function Vulnerabilities({ data }: { data: Rec }) {
  const vulns = records(data.vulnerabilities);
  const keys = strings(data.advisory_keys);
  const advisories = num(data.advisories);
  if (vulns.length === 0 && keys.length === 0) {
    return advisories !== null && advisories > 0 ? <Notice className="mt-3">{advisories} security advisories.</Notice> : null;
  }
  return (
    <Section label={`Security advisories (${vulns.length || keys.length})`}>
      <ul className={cn("flex gap-1 text-[0.8125rem]", vulns.length > 0 ? "flex-col" : "flex-wrap gap-x-3")}>
        {vulns.map((v, index) => (
          <li key={rowKey(v, index)} className="flex flex-wrap items-baseline gap-x-2">
            <ExtLink href={v.link ?? `${OSV_URL}${str(v.id) ?? ""}`} className="font-mono">
              {str(v.id) ?? "advisory"}
            </ExtLink>
            {strings(v.aliases).length > 0 && <span className="text-xs text-muted-foreground">{strings(v.aliases).join(", ")}</span>}
            {strings(v.fixed_in).length > 0 && <span className="text-xs text-ink-2">fixed in {strings(v.fixed_in).join(", ")}</span>}
          </li>
        ))}
        {vulns.length === 0 &&
          keys.map((key) => (
            <li key={key}>
              <ExtLink href={`${OSV_URL}${encodeURIComponent(key)}`} className="font-mono">
                {key}
              </ExtLink>
            </li>
          ))}
      </ul>
    </Section>
  );
}

/** Packages and repositories (npm, PyPI, deps.dev, GitHub repo and release). */
export function PackageCard({ data }: { data: Rec }) {
  // A release (github/latest-release) is titled by its repo; its `name` is the release's own title.
  const isRelease = str(data.tag) !== null;
  const name = (isRelease ? pickStr(data, "repo", "full_name", "name") : pickStr(data, "name", "full_name", "repo")) ?? "Package";
  const version = pickStr(data, "version", "default_version", "tag");
  const system = pickStr(data, "system", "ecosystem");
  const description = pickStr(data, "description", "summary");
  const licenses = [...new Set([...strings(data.licenses), ...(str(data.license) ? [str(data.license) ?? ""] : [])])];
  // The date of the version in the pill: deps.dev's latest_published_at is the newest of any line, not the default.
  const published = data.default_published_at ?? data.latest_published_at ?? data.uploaded_at ?? data.published_at;
  const engines = Object.entries(rec(data.engines)).map(([engine, range]) => `${engine} ${String(range)}`);
  const topics = strings(data.topics).slice(0, CHIPS_PREVIEW);
  const links = linksOf(data);
  const downloads = num(data.weekly_downloads);
  const stats: Array<[string, number | null, string?]> = [
    ["Weekly downloads", downloads, str(data.downloads_period) ?? undefined],
    ["Stars", num(data.stars)],
    ["Forks", num(data.forks)],
    ["Open issues", num(data.open_issues)],
    ["Versions", num(data.versions_count)],
    ["Deprecated versions", num(data.deprecated_versions)],
    ["Dependencies", num(data.dependencies)],
    ["Maintainers", num(data.maintainers)],
  ];
  const presentStats = stats.filter(([, value]) => value !== null);
  const releaseName = str(data.name) && str(data.tag) && str(data.name) !== str(data.tag) ? str(data.name) : null;
  const body = str(data.body);
  const versions = records(data.recent_versions ?? data.releases);
  const related = relatedOf(data);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-lg leading-tight font-semibold tracking-[-0.02em] break-all text-foreground">{name}</h4>
        {version && <Pill tone="brand">{version}</Pill>}
        {system && <Pill tone="outline">{system}</Pill>}
        {data.prerelease === true && <Pill>pre-release</Pill>}
        {data.is_default === true && <Pill tone="success">default version</Pill>}
        {data.fork === true && <Pill>fork</Pill>}
      </div>
      {releaseName && <p className="mt-0.5 text-[0.8125rem] text-ink-2">{releaseName}</p>}
      {description && <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">{description}</p>}
      <Meta className="mt-1.5">
        {licenses.length > 0 && <span>{licenses.join(", ")}</span>}
        {str(data.language)}
        {str(data.requires_python) && `Python ${str(data.requires_python)}`}
        {engines.length > 0 && engines.join(", ")}
        {str(published) && (
          <span>
            published <TimeAgo value={published} />
          </span>
        )}
        {str(data.pushed_at) && (
          <span>
            last push <TimeAgo value={data.pushed_at} />
          </span>
        )}
        {str(data.first_published_at) && (
          <span>
            first release <TimeAgo value={data.first_published_at} />
          </span>
        )}
      </Meta>
      <Notices data={data} />
      {presentStats.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {presentStats.map(([label, value, title]) => (
            <Stat key={label} label={label} value={value !== null ? formatCount(value) : null} title={title} />
          ))}
        </div>
      )}
      {topics.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {topics.map((topic) => (
            <li key={topic} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2">
              {topic}
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[0.8125rem]">
          {links.map(([label, href]) => (
            <ExtLink key={href} href={href} icon>
              {label}
            </ExtLink>
          ))}
        </p>
      )}
      <Vulnerabilities data={data} />
      {versions.length > 0 && <Releases versions={versions} />}
      {body && (
        <Section label="Release notes">
          <Markdown clampChars={RELEASE_NOTES_CLAMP_CHARS}>{body}</Markdown>
        </Section>
      )}
      {related.length > 0 && (
        <Section label="Related projects">
          <ul className="space-y-0.5 text-[0.8125rem]">
            {related.map(([id, relations]) => (
              <li key={id}>
                <ExtLink href={`https://${id}`} className="font-mono">
                  {id}
                </ExtLink>
                {relations.length > 0 && <span className="ml-2 text-xs text-muted-foreground">{relations.map(humanize).join(", ")}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
