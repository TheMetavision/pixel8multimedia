Prankz! — Service Workflow Bible

Service: Prankz!

Slug: /services/prankz

Sanity ID: 15hxv4Rz0BxauBoW2SzsOs

Owner: Alan / Pixel8 Multimedia

Bible version: 1.0

Last updated: 19 May 2026

Status: Eighth of 11 Pixel8 service bibles — first of the four "consent-required" services

Sort order: 12



1\. Service Definition

One-paragraph promise

Prankz! takes a clear photo of a friend, family member, or colleague — the "victim" — and creates a photorealistic fictional scenario designed to make the recipient do a double-take. The output is a still image (and optionally a 30-second animated short with custom soundtrack and AI voiceover) that looks just real enough to provoke a confused "WHAT IS THIS?!" reaction. Outputs are harmless, reversible, and designed for sharing in private friend / family / colleague contexts — never for public defamation or harassment.

Customer profile



Friend groups — pranking a mate for a birthday, leaving event, group joke

Office workplaces — colleagues pranking each other (especially leaving cards, promotions, retirements)

Family banter — siblings, in-laws, cousins — long-running inside jokes

Sports/club groups — football team WhatsApp groups, golf clubs, rugby teams — natural Prankz audience

Sport-rivalry banter — fan-base teasing (e.g. "A Bit Spursy" example)

Celebration "roasts" — milestone birthdays / hen / stag dos / retirements where the recipient is in on the joke



The emotional axis is playful humour / shared comedy. Prankz commissions are almost always for someone the customer KNOWS — pranking strangers is structurally disallowed by the consent framework.

What this service IS



A harmless prank product — fictional, entertainment-only, reversible

A composite photo / short animation service — similar production shape to Missing Moment but inverted in tone (comedy not grief)

A photo-realistic-but-fake creation — the humour comes from "wait, is that real?" before the reveal

A consent-required service — customer must affirm legitimate photo ownership and harmless intent

An explicitly refusal-protected service — Pixel8 reserves the right to refuse anything that crosses into harmful territory



What this service is NOT



A defamation service — nothing that creates false impressions damaging to a real person's reputation

A harassment / stalker tool — strict consent + relationship-evidence framework

An explicit / NSFW service — flat refusal regardless of customer claims

A "make this person do something they'd never do" service in any reputationally-damaging sense

A service for pranking strangers, celebrities, or public figures

A service for permanently-damaging content — outputs should be the kind of thing a recipient laughs at, not the kind they need a lawyer over



⚠️ Safety framework — Pixel8's core operational discipline on this service

From importantNote and prankConsent:



Customer confirms via checkbox that:



The prank is harmless

They have the subject's photo legitimately

The output is understood to be fictional and for entertainment only





Pixel8 reserves the right to refuse commissions judged to be:



Harmful

Harassing

Defamatory

Sexual / explicit

Otherwise unsuitable





Outputs are designed to be:



Harmless

Reversible

Prank-safe







Strategic position vs. other Pixel8 services



vs. Missing Moment — structurally similar (composite + optional animation) but emotionally inverted (laughter vs grief)

vs. The Day I Met / Scene Stealer — those services place customer into a fictional fame/movie scene; Prankz creates a fictional scenario starring someone the customer knows

As the "entry to consent-required services" — Prankz is the simplest of the four consent-required services; the safety framework here transfers to Day I Met and Scene Stealer

As the catalogue closer (sortOrder: 12) — positioned as the fun, lighter-tone offering after the serious commissions





2\. Deliverables Matrix

Pricing tiers (live in Sanity)

PathCustomer paysWhat customer getsSanity fieldDigital Download£19.99One photorealistic prank composite as digital filedigitalPriceSingle Printfrom £29.981 print + digital file. Includes £19.99 artwork fee.derivedBundle (2+ prints)from £39.97Digital file + 2 or more prints. £19.99 artwork fee waived per extra print.derivedAnimation (Music)£79.9930-second animated short with custom soundtrack + digital stillanimationMusicPriceAnimation + Voiceover£99.9930-second animated short with custom soundtrack AND AI voiceover + digital stillanimationVoPrice

Pricing mirrors Missing Moment exactly. The structural similarity is intentional.

Print format pricing (live in Sanity printUpcharges)

FormatSmall (12×8")Medium (16×12")Large (24×16")Poster£9.99£12.99£16.99Canvas Standard£26.99£31.99£44.99Canvas Gallery£28.99£33.99£46.99

Artwork fee logic



artworkFee: £19.99

artworkBundledWithDigital: true (waived per print on Bundle path)

artworkFeePerOrder: false



File delivery



Digital still: PNG, high-resolution (typical 2752×1536 or matching original aspect)

Animation: MP4, 30 seconds, 1080p minimum

Naming convention: prankz-<commission-ref>-<tier>.<ext>

Delivery method: Secure download link via Resend transactional email

Print fulfilment: Printful, dispatched to Stripe-collected shipping address





3\. Customer Briefing Fields

Fields configured in Sanity (live, in display order)

Field keyLabelTypeRequiredShows forNotescustomerName"Your name"text✓allDisplay onlycustomerEmail"Email address"email✓allDelivery destinationsubject"Who is this for?"text✓allThe "victim" — friend, family, colleaguesubjectPhoto"Photo of the victim"photo✓allClear photo of the subjectscenario"The absurd scenario"textarea✓allThe prank concepttone"How mean?"select✓all3 levelssceneAction"Scene direction (optional)"textarea—animation paths30-second setup-escalation-reveal directionmood"Mood"select—animation paths7 optionsmusicGenre"Music style / genre"select✓animation paths8 genre optionsvoiceoverScript"Voiceover script (optional)"textarea—VO path\~80 words for 30svoiceCharacter"Voice characteristics"select✓VO path9 optionsvoiceAccent"Accent"select✓VO path9 optionsvoiceNotes"Voiceover notes"textarea—VO pathTone, pauses, emphasisnotes"Anything else we should know?"textarea—allCatch-allprankConsent"I confirm this is a harmless prank..."checkbox✓allThe safety gate

Total: 15 fields. One more than Missing Moment because of the consent checkbox.

Tone options



Gentle (they'll laugh) — playful, no edge, immediately funny

Pointed (they'll laugh, eventually) — has bite, recipient may need a moment

Savage (consequences possible) — sharp edge, friendship might survive but only just



Mood options

Leave it to you · Suspicious / "wait what" · Cinematic and serious (heightening the absurdity) · Slapstick / comedy · Dramatic / horror parody · News-report serious · Soap opera / tabloid

Music genre options

Leave it to you — match the mood · Dramatic / cinematic suspense · Slapstick / comedy · News theme / serious investigative · Soap opera / tabloid drama · Action / thriller · Quirky / playful · Tense / building dread

Voice character options

Leave it to you · News anchor (male, serious) · News anchor (female, serious) · Documentary narrator · Soap opera narrator / dramatic · Sports commentator (excitable) · Reality TV narrator · Old movie newsreel announcer · Custom (describe in notes)

⚠️ All voice options skew toward parody-broadcast formats. Romance / heartfelt voice options deliberately don't appear.

Voice accent options

Leave it to you · British (RP) · British (Northern) · British (Scottish) · British (Welsh) · British (Irish) · American (Neutral) · American (Southern) · Australian · Other (describe in notes)

Consent checkbox

Label: "I confirm this is a harmless prank, I have the subject's photo 

&#x20;       legitimately, and I understand the output is fictional and for 

&#x20;       entertainment only."



Helper text: "We reserve the right to refuse any commission we judge to be 

&#x20;             harmful, harassing, defamatory, sexual, or otherwise unsuitable."



Required: TRUE

The consent affirmation is necessary but not sufficient — operator right to refuse remains.

What "good" briefing data looks like



subject: "My mate Dave from work, 34, our group has been winding him up about \[thing] for years"

scenario: specific and visualisable — "Dave riding a giant carrot through the office car park, with terrified colleagues running away. Should look like a CCTV still / news photo."

tone: "Gentle" or "Pointed" preferred; "Savage" only for confirmed friend-group / private-share contexts

notes: context that helps operator gauge intent — "It's for his stag do, we've all been pranked already"

prankConsent: ticked



What "bad" briefing data looks like



Subject relationship unclear or ominous — "my ex" + savage tone + no context = red flag

Scenario in defamatory situation (crime, sexual, financial wrongdoing) — REFUSE

Real third party drawn in negatively — refuse the third-party involvement

Notes mention intent to publish for public mockery — caution, possibly refuse

Customer indicates real deception intent beyond moment of reveal — refuse



Briefing-stage rejection criteria



Subject photo not personal relationship (stranger, celebrity, public figure) — REFUSE

Scenario depicts subject committing crime, sexual / compromising situation — REFUSE

Real third party as victim of the prank — REFUSE the involvement

Pattern of escalating prankz against the same subject — flag for manual review

Photo clearly stolen / paparazzi / non-consensual — REFUSE

Subject is a minor — REFUSE (Prankz is adult subjects only)

Notes contradict consent affirmation (malicious intent) — REFUSE, document





4\. Production Pipeline

Stage 0 — Commission paid (automated)

Standard Stripe webhook flow.

Stage 1 — Brief review + safety assessment (\~10-15 min)

Most rigorous brief review of any Pixel8 service because of the safety framework.



Verify prankConsent ticked

Read subject, scenario, tone, notes together — what's the intent?

Apply rejection criteria from §3

If borderline: email customer for clarification BEFORE production

If unacceptable: refuse with empathy, refund

If acceptable: mark inProduction



Stage 2A — Composite still production (\~30-45 min, all paths)

Production technique mirrors Missing Moment §4 Stage 2A, with key difference: Prankz outputs intentionally look photoreal-but-impossible. Must read as photoreal at first glance — then absurd on reflection.



Open source photo in Photoshop / Affinity Photo

Generate scenario composite via GPT Image 2 (subjectPhoto as medias\[] reference)

Composite onto realistic background using layer masks

Add subtle "amateur photo" feel where scenario suggests (CCTV, paparazzi, news photo)

Final QA — does it read as "wait, is this real?" at first glance?

Save: prankz-<ref>-still.png



Stage 2B — Animation production (\~30-60 min, animation paths only)



Apply motion matching the scenario

Camera moves: slow dolly, zoom, pan

Subtle character motion (head turn, slight movement, NOT lip-sync)

30-second arc: setup (5-10s) → escalation (10-15s) → reveal/punchline (5-10s)

Render 1080p, 30s, MP4



Stage 2C — Soundtrack production (\~10-20 min, animation paths only)



Generate via Suno matching musicGenre + mood

Prankz soundtracks more deadpan-serious than other services — comedy is in mismatched register

30-second arc: serious build → absurd peak → resolve



Stage 2D — Voiceover production (\~10-15 min, VO path only)



Generate via ElevenLabs matching voiceCharacter + voiceAccent

Prankz voices = parody-broadcast — lean INTO seriousness, NOT slapstick



Stage 2E — Final assembly (\~5-10 min, animation paths only)



Layer motion video + soundtrack + VO

Mix audio: music \~-18 to -22 dB, VO \~-6 to -9 dB

Render H.264 MP4, 1080p, 30s



Stage 3 — QA (\~5 min)

Includes one extra step: the "is this actually funny?" check.

Stage 4 — Delivery (\~5-10 min)



Upload to secure destination

Send delivery email with appropriately playful tone

Mark delivered, trigger Printful



Stage 5 — Print fulfilment

Standard Printful flow.

Stage 6 — Post-delivery review (\~3 min, 7-14 days)

Standard flow. No memorial buffer.

Total operator time per commission

PathTotalDigital Still\~30-45 minAnimation (Music)\~75-135 minAnimation + VO\~85-150 min

Same profile as Missing Moment.



5\. AI Prompt Templates

Composite still — master template

COMPOSITE TASK: Place the supplied subject into the scenario described below.

The output must look photoreal at first glance — like an actual photograph

that could fool someone for 1-2 seconds before revealing its absurdity.

This is the core comedic mechanic of Prankz: "wait, is that real?"



SUBJECT PRESERVATION: Render the subject with their face, facial structure,

skin tone, age, ethnicity, gender, and identifying features matching the

reference photo exactly. The recipient must immediately recognise themselves.



SCENARIO: \[INSERT customer's scenario field verbatim]



TONE GUIDANCE (from customer's tone field):

\- Gentle: warm absurdity, immediately funny, no edge

\- Pointed: sharper humour with slight roast quality, still affectionate

\- Savage: edgier roast, but NEVER cruel — always recoverable by a laugh



PHOTOREAL FRAMING: Make this look like a real photo. Subtle imperfections

help — slight motion blur, amateur framing, phone-camera quality, or CCTV /

news-photo feel if scenario suggests it. NOT polished cinematic render

unless scenario explicitly calls for that.



LIGHTING MATCH: Realistic lighting on subject and scenario elements —

directional light, soft shadows, colour temperature consistency.



BANNED (firm Pixel8 policy regardless of customer notes):

\- Modern logos, brand names, trademarked characters

\- Nudity, sexual or suggestive content

\- Subject committing a crime, being arrested, in legal trouble (could be

&#x20; misread as real evidence)

\- Subject in compromising situations involving real third parties

\- Defamatory contexts (criminal, abuser, fraud)

\- Content that could damage subject's reputation beyond the reveal

\- Gore, violence, blood, death

\- Text overlays, dates, watermarks, captions



ASPECT RATIO: \[Match original photo OR shift to 16:9 landscape for news/

CCTV framings — operator choice based on scenario]



RESOLUTION: 2752×1536 minimum (or matching original aspect equivalent).

Animation prompt — master template

ANIMATION TASK: Apply subtle motion to the supplied photoreal-but-absurd

still. 30-second prank video — "presented as real, actually fake".



MOTION TYPE: Match scenario's implied media format:

\- "News photo": slight zoom-in (TV news cutaway feel)

\- "CCTV still": low-fidelity feel, slight digital judder, occasional static

\- "Phone snapshot": slight hand-held wobble

\- "Paparazzi shot": motion blur, candid feel



CHARACTER MOTION: Subtle, not exaggerated. Head turn, slight movement,

NOT lip-sync.



30-SECOND ARC:

\- 0-10s: setup — image holds, viewer takes it in

\- 10-20s: escalation — slight motion adds context, subtle reveal detail

\- 20-30s: hold / resolve — let absurdity land, gentle motion to fade-out



BANNED:

\- Lip-sync to voiceover

\- Vigorous physical action

\- Realistic gore / violence / death

\- Anything breaking the photoreal-but-fake illusion into discomfort



DURATION: 30 seconds exactly.

RESOLUTION: 1080p minimum.

Music generation — Suno prompt template

A 30-second instrumental track in \[musicGenre] style.



Mood: \[mood field — note: comedy works when music is MORE SERIOUS than visual]



Scenario context: \[one-sentence summary]



Structure:

\- 0-5 sec: serious intro, "real" tone

\- 5-22 sec: builds toward absurd peak

\- 22-30 sec: resolves with absurdity still hanging



The mismatched-register rule: if scenario is absurd, music should be

straight-faced. Comedy comes from contrast.



No vocals.

Generated for use under spoken VO — keep dynamics manageable.

Voiceover generation guidance (ElevenLabs)



Match voiceCharacter to closest voice (news anchor / documentary / etc.)

Settings:



Stability: 0.5-0.7 (more stable than emotional services)

Similarity boost: 0.7-0.85

Style exaggeration: 0.1-0.3 (LOW — flat broadcast delivery is funnier)





The flatter the delivery, the funnier the absurd content.



Operator-written VO script templates

News-anchor template:

"Reports are emerging tonight of \[bizarre scenario in flat news tone]. 

\[Name] was seen \[absurd action] earlier this afternoon, prompting confusion 

from local residents who described the scene as \[understated descriptor]. 

Authorities are urging the public to \[absurd response]. We'll have more on 

this developing story as it unfolds."

Documentary-narrator template:

"In a quiet corner of \[location], an unusual story is unfolding. \[Name] — 

\[age, brief description] — has been \[absurd action] for \[absurd duration]. 

Experts are baffled. Friends are bewildered. And the \[absurd object] shows 

no signs of \[absurd resolution implied]. This is \[name]'s story."

Sports-commentator template:

"AND HE'S GOT IT! \[Name] has just \[absurd action]! UNBELIEVABLE scenes here 

today, the crowd cannot believe what they're seeing! \[Absurd context]! This 

will go down in history! \[Sign-off in commentator voice]."

The mismatched-register rule applies to scripts too — the more seriously the VO delivers absurd content, the funnier it lands.



6\. Reference Materials

Source photo requirements



Resolution: ≥1500px on long edge

Subject face: \~25-50% of frame

Lighting: even, no extreme shadows

Angle: front-facing preferred

Single subject preferred

No sunglasses / heavy filters

Adult subject only



Customer-facing examples (Sanity examples\[])

ExampleUse caseToneMate...That's My Nan!Friend group prankPlayful, "wait what"A Bit SpursySports rivalry banterPointed, fan-base humourCarrots Have Feelings To!Absurdist comedyGentle, surreal

Each example shows Original photo + Digital Still + Music tier + Music+VO tier YouTube embed.

YouTube proof videos

ExampleMusic tierMusic+VO tierMate...That's My Nan!vkBxQcUuKeAkHnJHdncDNAA Bit Spursy6v47Mtwm6vEE1hdh9tsFigCarrots Have Feelings To!w51V1uqMjHIIVcF9Ql1BLA

Critical for animation-tier conversions.



7\. QA Checklist

Composite still

Likeness preservation



&#x20;Subject's face matches reference

&#x20;Recipient will immediately recognise themselves

&#x20;No race-swap, age-shift, identity distortion



Photoreal-but-fake illusion



&#x20;Reads as photoreal at first glance

&#x20;Absurdity registers on reflection

&#x20;Lighting / shadows match

&#x20;Scale correct relative to scenario elements

&#x20;No "obvious AI" tells



Tone alignment



&#x20;Matches customer's tone selection

&#x20;Gentle: no edges, immediately funny

&#x20;Pointed: has bite but recoverable

&#x20;Savage: sharper but NEVER harmful



Safety check (critical)



&#x20;No nudity, sexual, suggestive content

&#x20;No depiction of crime / arrest readable as real

&#x20;No defamatory context

&#x20;No real third party depicted negatively

&#x20;No gore / violence / death

&#x20;No content damaging reputation beyond reveal

&#x20;If leaked publicly, still defensible as clear prank



Animation



&#x20;Duration 30 seconds exactly

&#x20;1080p

&#x20;Motion supports photoreal-but-fake illusion

&#x20;No lip-sync attempts

&#x20;Setup → escalation → reveal arc

&#x20;No AI artefacts



Audio

Music



&#x20;30 seconds with fades

&#x20;Genre matches customer choice

&#x20;Register is appropriately serious (comedy mechanic)

&#x20;Dynamic range suitable for VO mixing



Voiceover



&#x20;Voice character matches

&#x20;Accent matches

&#x20;Flat / professional broadcast delivery (not performed)

&#x20;Pacing fits 30-second visual



"Is it actually funny?" check



&#x20;Operator paused to assess: does this LAND as comedy?

&#x20;If technically correct but flat: revisit





8\. Failure Modes \& Fixes

Looks too obviously AI-generated

Fix: stronger photoreal cues, add "amateur photo" character, composite manually if needed.

Photoreal but not absurd enough

Risk: someone might think it's real and use it accordingly.

Fix: push scenario toward clearly impossible. Photoreal-but-impossible is the goal.

Tone mismatch

Fix: regenerate with tone-aligned prompt adjustments.

Borderline content the customer doesn't see as borderline

Process: pause production, email customer to clarify, suggest safer alternative, refuse if customer insists.

Real third party drawn in by association

Process: refuse to involve second person, suggest fictional setup.

Customer reveals malicious intent in notes

Process: refuse commission, refund, document. Do not engage in back-and-forth.

Animation overshoots the prank

Fix: trim escalation phase, hold longer on setup or reveal.

VO sounds too animated / performed

Fix: lower stability + lower style exaggeration. Choose more stoic voice character.

Customer rejection ("It's not funny")

Process: acknowledge in 24h, ask what's missing, one free revision, refund if still unhappy.

Customer rejection ("You went too far / too soft")

Fix: adjust tone, regenerate. Free revision.



9\. Delivery \& Handover

Delivery email — digital still

Subject: Your Prankz creation is ready 👀

Hi \[Customer name],



Your Prankz commission is finished. \[Subject name] is about to have an 

extremely confusing afternoon.



Download here:

\[Secure download link — expires in 30 days]



In the bundle:

\- The high-resolution prank image

\- A reminder: this is a fictional creation, designed for harmless 

&#x20; prank-and-reveal fun



Send it. Wait for the reaction. Then admit it before the friendship 

gets weird.



If anything's not quite right, reply to this email — one free revision 

included.



\[Operator name]

Pixel8 Multimedia

Delivery email — animation (Music)

Subject: Your Prankz animation is ready 👀

Hi \[Customer name],



Your 30-second Prankz video is ready. This one's going to land.



Download here:

\[Secure download link — expires in 30 days]



In the bundle:

\- The digital still

\- The 30-second animated short (MP4, 1080p)

\- The custom soundtrack



A reminder: fictional, for harmless prank fun. Make sure to reveal the 

prank — don't let it run too long.



If anything needs tweaking, reply — one free revision included.



\[Operator name]

Pixel8 Multimedia

Delivery email — animation + VO

Same structure with addition:

\- The 30-second animation now includes the voiceover. The \[voice character 

&#x20; description] reads the scenario in their best straight-faced delivery — 

&#x20; which is, of course, the point.

Clarification email — borderline content

Subject: A quick check on your Prankz brief

Hi \[Customer name],



Thanks for the order! Before we start production, we wanted to flag one 

thing about the scenario you described.



\[Specific issue — e.g. "You've described making it look like Dave was 

arrested. We try to steer clear of anything that could be misread as real 

evidence of a crime, even when it's clearly a joke — too easy for the image 

to escape its prank context and cause genuine trouble for Dave (or you, 

depending on context)."]



Could we propose this instead:



\[Safer alternative that preserves the joke]



If that works, just reply yes and we'll get going. If you'd rather chat 

through other options, happy to do that.



\[Operator name]

Pixel8 Multimedia

Clarification email — third-party concern

Subject: Quick question about your Prankz brief

Hi \[Customer name],



Thanks for the order!



One quick thing: your scenario mentions \[third party]. We're conscious about 

prankz that pull in a real second person who hasn't consented to being part 

of the joke — even when it's clearly fictional.



Two options:



1\. Same scenario but with \[third party] replaced by a fictional / generic 

&#x20;  character

2\. If \[third party] is in on the prank and OK with featuring, just confirm 

&#x20;  and we'll proceed as briefed



Just let us know which works.



\[Operator name]

Pixel8 Multimedia

Refusal email — policy violation

Subject: Your Prankz commission

Hi \[Customer name],



Thanks for placing the order. After reviewing the brief, this one falls 

outside what we can deliver under our content policy — specifically, 

\[brief reason].



We've refunded the order in full (3-5 working days to your card).



If you'd like to commission a different prankz for \[subject name] — absurd 

scenarios, fictional setups, exaggerated comedy — we'd love to help. Just 

place a new order with a different brief.



Sorry we couldn't help with this specific one.



\[Operator name]

Pixel8 Multimedia

Refund email

Standard format — keep tone light given Prankz's playful brand voice.



10\. Edge Cases \& Operator Decisions

Customer claims relationship to subject that's hard to verify



Default: trust the consent affirmation

Red flags: stalker/obsessive intent, Savage tone + no group-share context, non-consensual photo

Process: ask clarifying questions if red flag. Refuse if answers don't satisfy.



Sport rivalry pranks



✅ Acceptable and common

Practice: parody-news framing, sports commentator VO, rivalry inside jokes

Avoid defamatory content about real footballers / managers



Workplace pranks



✅ Acceptable when targeting a colleague in good fun

Caution: HR implications. If brief reads as harassment-adjacent, flag and ask.



Pranks involving children



❌ Subjects MUST be ADULTS

Refuse, refund, escalate



Pranks involving deceased people



Generally not in line with Prankz's spirit

Exception: clearly affectionate "remembering uncle Dave" framing

Operator judgement; refuse if uncomfortable



Pranks intended for public sharing



Default: private prank between known people

Caution if customer indicates broader sharing intent

Refuse if intent is public humiliation



Real estate / "I left my partner" pranks



✅ For friend-group reveals

❌ When intent is actual deception (fake "we got married" photos sent to those who'll believe it)



Fake news framing



✅ When fake news headline is clearly absurd

❌ When mistakeable for real political / disaster / crime events



Pranks involving disasters / crimes / serious situations



❌ Never acceptable

Even with absurd framing, legal / reputational risk is too high



"Birthday roast" commissions



✅ Acceptable in group-celebration roast context

Tone tends Pointed-to-Savage; that's the spirit



Copyrighted scene requests



E.g. "kidnapped by Sauron from Lord of the Rings"

Use generic equivalents ("a dark fantasy lord")

Refuse if customer insists on exact IP replication



Escalating prankz patterns



✅ As long as each commission individually meets safety bar

Refuse if pattern suggests obsession or harassment



Romantic / sexual edge cases



❌ NEVER produce sexual / sexualised content under any framing

"Fake dating" prankz — case-by-case, third-party consent considerations apply

Refuse anything that could be interpreted as non-consensual





11\. Reference Builds \& Source Files

In code



src/components/CommissionWorkflow.jsx — wizard with 15 fields including consent checkbox enforcement

src/components/PricingStrip.astro — 5-card pricing strip

src/pages/services/\[slug].astro — page template (standard mode)

netlify/functions/commission-checkout.mts — Stripe session

netlify/functions/stripe-webhook-commission.mts — post-payment patch



Wizard consent enforcement

prankConsent is enforced at submit time. Order cannot be placed without it ticked. Submitted boolean value stored in commission doc as evidence of customer affirmation. Worth verifying this captures in webhook flow.

In Sanity



Service doc ID: 15hxv4Rz0BxauBoW2SzsOs

Project: bqb4w421, dataset production

Studio: pixel8multimedia.sanity.studio

Examples: 3 with Original + Digital Still + YouTube video pair each



Live URLs



Page: https://pixel8multimedia.netlify.app/services/prankz

Studio: https://pixel8multimedia.sanity.studio



Prankz's place in Pixel8's catalogue

Lightest-tone service in the catalogue. Despite this, the service with the most operationally critical safety framework. The consent + refusal framework here establishes the pattern for the next three consent-required services.



12\. Open Items \& Follow-ups



Production composite prompts review — wizard prompts must enforce photoreal-but-impossible discipline + banned-content list. Pending.

Consent log retention — prankConsent: true should persist with timestamp on commission record for defensive evidence. Pending verification.

Borderline-content automated flagging — wizard scans scenario / notes for high-risk keywords, surfaces for operator review BEFORE payment. Pending.

Refund automation for refused commissions — currently manual. Could be partially automated. Pending.

Refusal documentation system — log all refusals with reason codes for pattern analysis. Pending.

Customer education before payment — wizard surfaces examples of what we WILL / WON'T do BEFORE customer enters brief. Pending UX.

Operator-side review queue — high-risk commissions route to manual-review queue instead of standard flow. Pending workflow design.

Memorial detection NOT needed for this service — no memorial use case.

VO library expansion — consider more specific voices ("podcast host", "true-crime narrator"). Pending.

Brand-voice copywriting consistency audit — service description, examples, delivery emails all use casual / playful tone. Pending periodic audit.





Bible governance



Owner: Alan / Pixel8 Multimedia

Update frequency: As safety / refusal patterns accumulate, as consent-required service framework matures across the four services

Version control: docs/service-bibles/prankz.md

Linked artefacts:



Sanity service doc 15hxv4Rz0BxauBoW2SzsOs

YouTube proof videos (six — see §11)





Previous bibles: back-in-time, the-missing-moment, crayon-to-creation, cartoonify-me, past-perfect, your-song-your-story, story-of-your-life

Next service to bible: The Day I Met





End of Prankz! Service Workflow Bible v1.0

