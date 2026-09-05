# Forest Watch — Canonical Hackathon Brief

This file is the single source of truth for every AI tool working in this
workspace. The canonical workspace is `C:\Users\medha\Desktop\Hackathon Project`,
and the application source is in `frontend/`.

Do not use `Newsletter-Platform` as context, a data source, or a destination for
this project.

## Problem statement

Build an AI-powered decision-support system for monitoring implementation of
India's Forest Rights Act (FRA). FRA claims, approvals, and land-use records are
fragmented across states, making progress difficult to monitor and anomalies
difficult to identify.

## Minimum hackathon acceptance criteria

The demo must make these three capabilities obvious to a judge:

1. A WebGIS-style map showing mock FRA claim data by district.
2. An anomaly layer that flags cases such as delayed claims and mismatched land
   records, with a concise AI-generated or AI-assisted explanation.
3. A decision-support panel summarizing state-wise progress and highlighting
   where an official should investigate.

Real geographic boundaries may be combined with clearly labelled synthetic FRA
claim records. Never present synthetic claim data as official government data.

## Extended product vision

The build may exceed the minimum brief with:

- a scroll-driven globe, world, and India exploration experience;
- forest-cover and tree-density visualization;
- citizen or field-worker issue reporting;
- WhatsApp-linked ticket creation and follow-up;
- Firebase-backed live ticket monitoring;
- dataset provenance, accessibility, privacy, and fair-use information;
- richer district drill-downs, trends, prioritization, and explainable alerts.

Extras support the FRA monitoring workflow; they must not replace the three
minimum acceptance criteria.

## Current implementation

Verified in `frontend/`:

- React, TypeScript, and Vite application;
- React Three Fiber globe plus world and India map scenes;
- scroll-driven GSAP transitions;
- placeholder world-region and Indian-state tree-density data;
- Firebase/Firestore connection;
- live ticket-list page;
- issue-reporting page describing a planned WhatsApp flow.

## Core work still missing

- district-level India boundaries suitable for the FRA map;
- a documented mock FRA claim schema and realistic mock records;
- claim-status map layers, legends, filters, and district drill-downs;
- deterministic anomaly rules for delay and land-record mismatch;
- AI anomaly-summary integration with evidence shown to the user;
- state-wise progress metrics and a decision-support dashboard;
- a complete judge-facing flow connecting map, anomaly, and recommended action;
- replacement of placeholder policy, contact, and dataset pages.

## Working rules for all AI tools

- Read this file before planning or editing.
- Inspect the current files before changing them and preserve unrelated work.
- Keep one AI tool as the active writer at a time; shared memory does not merge
  simultaneous file edits.
- Label mock data clearly and record the source of every real boundary dataset.
- Prefer deterministic, testable anomaly rules; use an LLM to explain evidence,
  not to invent claim facts.
- Do not claim a feature is complete until its user-visible flow is tested.
- Keep secrets out of source files and use environment variables for Firebase or
  model credentials.

