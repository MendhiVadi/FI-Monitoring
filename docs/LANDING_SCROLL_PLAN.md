# Landing scroll and Land Dispute presentation — 2026-09-16

## Observed problems

- The standalone ScrollTrigger has no attached tween: changing `scrub` does not
  smooth its `onUpdate` progress. The earlier scrub tweak was ineffective.
- Cubic progress easing and independent camera damping put zoom, rotation and
  fading on different schedules. The camera enters the sphere before India locks.
- All introductory text disappears early; browser inspection at roughly three
  quarters of a page of scroll showed an empty pinned viewport.
- Lazy-loading replaces a short fallback with a much taller section. Mobile
  viewport changes and unrestricted device pixel ratio add further instability.
- Visible product labels still describe Forest Watch despite the owner's move
  to Land Dispute.

## Implementation

1. Attach one short, linear scrub tween to a shared progress ref. Derive camera,
   orientation and opacity from that value; remove camera-only catch-up.
2. Rotate toward India earlier, keep the camera outside the globe, and retain
   readable copy and direct report/skip links throughout the intro.
3. Preserve the shorter 190vh desktop section, shorten touch/mobile to 160vh,
   use stable small-viewport units, cap pixel ratio, reserve lazy-loading space,
   and retain reduced-motion/WebGL fallbacks and offscreen render suspension.
4. Update visible web product branding and introductory descriptions to Land
   Dispute. Keep FRA-specific datasets, categories, contracts, identifiers and
   existing hosting addresses intact. Record the broader scope in the brief.
5. Verify browser scrolling forward/back, skip/report navigation, responsive
   layout and reduced motion. Run root checks, publish to the existing Vercel
   project, then verify the public alias. Record actual verification limits.

No backend or rule change is needed for this release.

## Verification and outcome

Implemented and deployed to the existing public Vercel address. All 41 tests,
architecture checks and production builds passed; existing warnings remain.
The initial emulator run required a retry after a sandbox access failure.
Desktop scrolling, reverse scroll, skip focus, report navigation, 390px/320px
layouts and reduced motion were inspected locally. The live opening and former
blank scroll point render correctly without browser errors. See `DEPLOYMENT.md`
for the deployment ID and exact verification boundaries.

## Suggested next improvements (not implemented)

1. Transition from India into a clearly labelled example land parcel or district
   outline, connecting the animation directly to reporting. Actual property
   boundaries require an appropriate sourced dataset.
2. Add a restrained “India → Locate land → Report” progress cue, retaining native
   scroll and the skip link rather than forcing scroll snapping.
3. Offer a lightweight 2D intro on slower devices. The lazy 3D bundle remains
   about 1 MB before compression; measure frame timing on physical touch devices
   before introducing more effects.

Technical reference: https://gsap.com/docs/v3/Plugins/ScrollTrigger/ describes
numeric scrub as animation catch-up. The old standalone callback had no animation
attached; the new implementation attaches one shared tween.
