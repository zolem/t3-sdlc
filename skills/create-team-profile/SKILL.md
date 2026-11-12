---
name: create-team-profile
description: Interviews whoever is setting t3-sdlc up for a team and writes the team profile, a small `team-profile` skill with the team's personas, domain rules, required screen states, devices, vocabulary and where handoffs go, so every teammate's role skills give the same team-specific answers. Use when someone wants to set up, create, update or share a t3-sdlc team profile.
---

# Create a team profile

The role skills (`write-product-spec`, `build-screen-index`, `review-design`, `check-handoff`) are generic. A team profile makes them specific to one team:
- its personas;
- the rules every spec must answer;
- the states every screen needs;
- its devices and vocabulary;
- where handoffs live.

The profile is itself a skill named `team-profile`, so it installs the same way as the others in every tool. Whoever sets t3-sdlc up for a team writes it once; teammates install it alongside their role skills.

Files in this skill's folder:
- `kit/templates/team-profile.md`: the skeleton to fill in. It becomes `team-profile/SKILL.md`.
- `kit/FORMAT.md`: the handoff format the profile feeds into.

## Interview

Ask one or two questions at a time, offer a proposed answer when you can, and skip what the person has already told you. If they have existing material (a product overview, a persona doc, a design-system page), read it first and only ask about what it leaves out.

1. **Product:** what it is, who pays, who uses it.
2. **Personas:** every kind of person who acts in the product, plus anyone who must never see certain things.
   - Give each a short id (`teacher`, `school-admin`) and say what they do and which devices they use.
   - Aim for the 3–7 personas that come up in most features.
3. **Domain rules:** the questions every spec at this company must answer. Probe for:
   - regulated or sensitive data (minors, health, payments);
   - multi-tenant boundaries;
   - billing effects;
   - audit needs;
   - localisation;
   - integrations that always break.
4. **Required screen states:** the generic five are `default, empty, loading, error, denied`. Does the product need more, such as `offline`, `read-only` or `partial`?
5. **Devices and accessibility:** supported devices and minimum widths, and the accessibility standard they hold themselves to.
6. **Vocabulary:** words the team uses precisely, and words to avoid.
7. **Where handoffs go:**
   - the tracker;
   - where the spec files live (ticket attachments, a shared folder, a repo path);
   - the design tool, and how to link a frame.
8. **Who to ask:** a person or channel for product, design and engineering questions.

## Write it

1. Fill `kit/templates/team-profile.md` in the team's own words. Replace `<Team>` in the front matter description too: that sentence is how agents decide to load it.
2. Show the person the finished profile and fix anything they correct.
3. Save it:
   - **Can write files:** create a folder named `team-profile` containing that `SKILL.md`, where the person chooses. A shared repo is best, so changes are reviewed.
   - **Cannot:** give the file as one Markdown block, and tell them to save it as `team-profile/SKILL.md`.

## Share it with the team

Tell the person how teammates get it:
- **Store the `team-profile` folder somewhere everyone can read:** a repo, a shared drive, or a link to the raw file.
- **Give teammates the one-line install with the profile in it**, so their agent installs it alongside their role skills:

  > Read https://github.com/zolem/t3-sdlc/releases/latest/download/INSTALL.md and follow it. Our team profile is at <link or path>.

- **For tools that take uploaded skills** (Claude desktop and claude.ai), a workspace admin can upload the `team-profile` folder as a zip once and share it with the whole organization.
- **When the profile changes,** teammates ask their agent to "update t3-sdlc".

## Never

- Invent personas or rules the person did not confirm.
- Put secrets, customer names or personal data in the profile. It is shared with every teammate's AI tools.
