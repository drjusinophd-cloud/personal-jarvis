/**
 * J.A.R.V.I.S. Architectural & Content Synthesis Generators
 * Produces runnable HTML apps, conversion business funnels, leadership book manuscripts,
 * and interactive student course portals — enhanced by Gemini when connected, and fully
 * functional out-of-the-box without external dependencies.
 */
window.JarvisGenerators = (function () {
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugify(text) {
    return String(text || 'creation')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 44) || 'creation';
  }

  function titleCaseFromPrompt(prompt, fallback) {
    const cleaned = String(prompt || '')
      .replace(/^(hey\s+jarvis|jarvis)[,\s]*/i, '')
      .replace(/^(please\s+)?(build|create|make|design|write|launch|generate)\s+(me\s+)?(a|an|my)?\s*/i, '')
      .trim();
    if (!cleaned) return fallback;
    return cleaned
      .split(/\s+/)
      .slice(0, 6)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /* =========================================================================
     1. APP FORGE GENERATOR
     ========================================================================= */
  function buildAppPackage(input) {
    const title = input.title || titleCaseFromPrompt(input.prompt, 'Apex Executive OS');
    const slug = slugify(title);
    const tagline = input.tagline || `Intelligent ${title} workspace built for high-performing leaders and founders.`;
    const appType = input.appType || 'saas-tracker';
    const primaryMetric = input.primaryMetric || 'Leadership Momentum Score';
    const accent = input.accent || '#0ea5e9';
    const defaultItems = input.seedItems || [
      { title: 'Define Q4 Strategic North Star & 3 Key Outcomes', category: 'Strategy', score: 95, done: true },
      { title: 'Publish Weekly Leadership Brief to Audience & Clients', category: 'Growth', score: 88, done: false },
      { title: 'Conduct 1-on-1 High-Trust Coaching Check-ins', category: 'Team', score: 92, done: false },
      { title: 'Review App MRR & Course Funnel Conversion Metrics', category: 'Business', score: 90, done: false }
    ];

    const html = input.customHtml || `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <style>
    :root {
      --bg: #070d19;
      --card: #0f1b31;
      --border: rgba(56, 189, 248, 0.24);
      --accent: ${esc(accent)};
      --text: #f1f5f9;
      --muted: #94a3b8;
      --ok: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    body { background: radial-gradient(circle at top, #102444, var(--bg) 60%); color: var(--text); min-height: 100vh; padding: 28px; }
    .wrap { max-width: 1040px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    .badge { display: inline-block; font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--accent); background: rgba(14,165,233,0.14); padding: 4px 10px; border-radius: 99px; margin-bottom: 6px; }
    h1 { font-size: 26px; font-weight: 800; }
    p.sub { color: var(--muted); font-size: 14px; margin-top: 4px; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .kpi { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    .kpi-val { font-size: 28px; font-weight: 800; color: #fff; }
    .kpi-lbl { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .grid { display: grid; grid-template-columns: 330px 1fr; gap: 20px; }
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
    .panel { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 1px; color: var(--accent); margin-bottom: 14px; }
    label { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 5px; }
    input, select, textarea { width: 100%; background: #07101f; border: 1px solid var(--border); color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 13.5px; }
    button { background: var(--accent); color: #04111f; border: none; border-radius: 8px; padding: 10px 16px; font-weight: 700; cursor: pointer; font-size: 13px; transition: 0.16s; }
    button:hover { filter: brightness(1.1); }
    button.ghost { background: rgba(255,255,255,0.08); color: #fff; }
    .item { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 13px 14px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); margin-bottom: 10px; }
    .item.done .it-title { text-decoration: line-through; color: var(--muted); }
    .tag { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: rgba(14,165,233,0.18); color: #7dd3fc; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <span class="badge">FORGED BY J.A.R.V.I.S. // ${esc(appType.toUpperCase())}</span>
        <h1>${esc(title)}</h1>
        <p class="sub">${esc(tagline)}</p>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="ghost" onclick="exportData()">Export JSON</button>
        <button onclick="resetDemo()">Reset Sample Data</button>
      </div>
    </header>

    <section class="kpis">
      <div class="kpi"><div class="kpi-val" id="kpiTotal">0</div><div class="kpi-lbl">Active Initiatives</div></div>
      <div class="kpi"><div class="kpi-val" id="kpiDone">0%</div><div class="kpi-lbl">Execution Rate</div></div>
      <div class="kpi"><div class="kpi-val" id="kpiScore">0</div><div class="kpi-lbl">${esc(primaryMetric)}</div></div>
    </section>

    <div class="grid">
      <div class="panel">
        <h2>New Action / Entry</h2>
        <label>Initiative or Milestone</label>
        <input id="inpTitle" placeholder="e.g., Launch Executive Cohort" />
        <label>Pillar</label>
        <select id="inpCat">
          <option>Strategy</option>
          <option>Leadership</option>
          <option>Growth</option>
          <option>Product</option>
          <option>Business</option>
        </select>
        <label>Impact Score (1-100)</label>
        <input id="inpScore" type="number" value="90" min="1" max="100" />
        <button style="width:100%;margin-top:16px;" onclick="addItem()">+ Add to Workspace</button>
      </div>

      <div class="panel">
        <h2>Live Execution Stream</h2>
        <div id="list"></div>
      </div>
    </div>
  </div>

  <script>
    const KEY = 'jarvis_app_${esc(slug)}_v1';
    const SEED = ${JSON.stringify(defaultItems)};
    function safeRead() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
    function safeWrite(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
    let items = safeRead() || JSON.parse(JSON.stringify(SEED));

    function save() {
      safeWrite(items);
      render();
    }
    function addItem() {
      const t = document.getElementById('inpTitle').value.trim();
      if (!t) return;
      items.unshift({
        title: t,
        category: document.getElementById('inpCat').value,
        score: Number(document.getElementById('inpScore').value || 85),
        done: false
      });
      document.getElementById('inpTitle').value = '';
      save();
    }
    function toggle(i) { items[i].done = !items[i].done; save(); }
    function removeItem(i) { items.splice(i, 1); save(); }
    function resetDemo() { items = JSON.parse(JSON.stringify(SEED)); save(); }
    function exportData() {
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '${esc(slug)}-data.json';
      a.click();
    }
    function render() {
      const total = items.length;
      const doneCount = items.filter(x => x.done).length;
      const avg = total ? Math.round(items.reduce((s, x) => s + Number(x.score || 80), 0) / total) : 0;
      document.getElementById('kpiTotal').textContent = total;
      document.getElementById('kpiDone').textContent = total ? Math.round((doneCount / total) * 100) + '%' : '0%';
      document.getElementById('kpiScore').textContent = avg;

      const el = document.getElementById('list');
      el.innerHTML = items.map((it, idx) => \`
        <div class="item \${it.done ? 'done' : ''}">
          <div style="display:flex;align-items:center;gap:12px;">
            <input type="checkbox" style="width:18px;height:18px;" \${it.done ? 'checked' : ''} onchange="toggle(\${idx})" />
            <div>
              <div class="it-title" style="font-weight:600;font-size:14px;">\${it.title}</div>
              <div style="margin-top:4px;display:flex;gap:8px;align-items:center;">
                <span class="tag">\${it.category}</span>
                <span style="font-size:12px;color:#94a3b8;">Impact: \${it.score}</span>
              </div>
            </div>
          </div>
          <button class="ghost" style="padding:6px 10px;font-size:12px;" onclick="removeItem(\${idx})">Delete</button>
        </div>
      \`).join('');
    }
    render();
  </script>
</body>
</html>`;

    const readme = `# ${title}

${tagline}

## Overview
- **Category**: Interactive Web Application
- **Generated By**: J.A.R.V.I.S. Multi-Laptop Command Center
- **Persistence**: LocalStorage + JSON Export

## Running Across Your 4 Laptops
Open \`index.html\` directly or access via your Central Hub preview URL from Windows or any of your 3 MacBooks.
`;

    return {
      category: 'apps',
      title,
      slug,
      summary: tagline,
      files: {
        'index.html': html,
        'README.md': readme
      },
      data: { appType, primaryMetric, tagline }
    };
  }

  /* =========================================================================
     2. ONLINE BUSINESS & VALUE-LADDER FUNNEL GENERATOR
     ========================================================================= */
  function buildBusinessPackage(input) {
    const brandName = input.title || titleCaseFromPrompt(input.prompt, 'Apex Leadership Digital Empire');
    const slug = slugify(brandName);
    const founder = input.authorName || 'Executive Founder';
    const featuredApp = input.featuredApp || 'Transformational Leader OS';
    const featuredBook = input.featuredBook || 'The Transformational Leader Playbook';
    const featuredCourse = input.featuredCourse || '90-Day Transformational Leadership Accelerator';
    const heroPromise = input.heroPromise || `Master modern leadership, deploy proven frameworks, and scale clarity across your organization with ${brandName}.`;

    const tiers = input.tiers || [
      { name: 'Starter App + Book Bundle', price: '$29', period: 'one-time', desc: `Digital & Audiobook edition of "${featuredBook}" plus instant access to ${featuredApp}.`, cta: 'Get the Book & App' },
      { name: 'Flagship Academy Course', price: '$297', period: 'lifetime access', desc: `Full enrollment in "${featuredCourse}", 6 video modules, leadership scorecards, and Pro App tier.`, cta: 'Enroll in Academy', featured: true },
      { name: 'Executive Advisory & Team License', price: '$1,490', period: 'per cohort / team', desc: 'Team-wide SaaS license for up to 25 leaders, monthly live executive roundtables, and custom playbooks.', cta: 'Apply for Cohort' }
    ];

    const html = input.customHtml || `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(brandName)} — Official Ecosystem</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, sans-serif; }
    body { background: #050b16; color: #f8fafc; line-height: 1.6; }
    .container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 22px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .logo { font-weight: 800; font-size: 18px; letter-spacing: 1px; color: #38bdf8; }
    .hero { text-align: center; padding: 76px 0 56px; }
    .pill { display: inline-block; padding: 6px 14px; border-radius: 99px; background: rgba(56,189,248,0.14); color: #38bdf8; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 18px; }
    h1 { font-size: clamp(32px, 5vw, 52px); line-height: 1.12; font-weight: 800; max-width: 820px; margin: 0 auto 18px; }
    .lead { font-size: 18px; color: #94a3b8; max-width: 680px; margin: 0 auto 30px; }
    .lead-form { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; max-width: 520px; margin: 0 auto; }
    .lead-form input { flex: 1; min-width: 240px; padding: 14px 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: #0d182c; color: #fff; font-size: 15px; }
    .btn { padding: 14px 24px; border-radius: 10px; border: none; background: linear-gradient(135deg, #00d2ff, #0284c7); color: #031120; font-weight: 800; font-size: 15px; cursor: pointer; }
    .pillars { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin: 40px 0 64px; }
    .card { background: #0c172a; border: 1px solid rgba(56,189,248,0.2); border-radius: 16px; padding: 26px; }
    .card.highlight { border-color: #38bdf8; box-shadow: 0 0 35px rgba(56,189,248,0.18); transform: translateY(-4px); }
    .price { font-size: 38px; font-weight: 800; margin: 12px 0 4px; color: #fff; }
    .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: none; place-items: center; padding: 20px; }
    .modal-box { background: #0f1e36; border: 1px solid #38bdf8; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <nav>
      <div class="logo">${esc(brandName.toUpperCase())}</div>
      <div style="font-size:14px;color:#94a3b8;">Founded by ${esc(founder)}</div>
    </nav>

    <section class="hero">
      <span class="pill">Apps • Leadership Books • Executive Academy</span>
      <h1>${esc(heroPromise)}</h1>
      <p class="lead">One integrated ecosystem combining the <strong>${esc(featuredApp)}</strong>, the book <em>${esc(featuredBook)}</em>, and the <strong>${esc(featuredCourse)}</strong>.</p>
      <form class="lead-form" onsubmit="captureLead(event)">
        <input id="leadEmail" type="email" required placeholder="Enter your best email for Chapter 1 + Free App Access..." />
        <button class="btn" type="submit">Unlock Free Access</button>
      </form>
      <p id="leadMsg" style="margin-top:12px;color:#34d399;font-size:14px;display:none;">Welcome aboard! Chapter 1 + App Invite unlocked.</p>
    </section>

    <h2 style="text-align:center;font-size:28px;margin-bottom:8px;">Choose Your Leadership Growth Path</h2>
    <p style="text-align:center;color:#94a3b8;margin-bottom:28px;">Seamless progression from daily execution tools to executive mastery.</p>

    <section class="pillars">
      ${tiers.map((t) => `
      <div class="card ${t.featured ? 'highlight' : ''}">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#38bdf8;font-weight:700;">${esc(t.name)}</div>
        <div class="price">${esc(t.price)}</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:14px;">${esc(t.period)}</div>
        <p style="color:#cbd5e1;font-size:14.5px;margin-bottom:22px;">${esc(t.desc)}</p>
        <button class="btn" style="width:100%;" onclick="openCheckout('${esc(t.name)}', '${esc(t.price)}')">${esc(t.cta)}</button>
      </div>`).join('')}
    </section>
  </div>

  <div class="modal" id="checkoutModal" onclick="this.style.display='none'">
    <div class="modal-box" onclick="event.stopPropagation()">
      <h3 id="mTitle" style="font-size:20px;margin-bottom:8px;"></h3>
      <p id="mPrice" style="font-size:30px;font-weight:800;color:#38bdf8;margin-bottom:14px;"></p>
      <p style="font-size:13.5px;color:#94a3b8;margin-bottom:18px;">Ready to connect your Stripe Payment Link, Polar, or Gumroad checkout URL in one line.</p>
      <button class="btn" style="width:100%;" onclick="alert('Order flow verified! Connect your Stripe/Polar checkout link in Business Studio.');document.getElementById('checkoutModal').style.display='none';">Complete Test Enrollment</button>
    </div>
  </div>

  <script>
    function captureLead(e) {
      e.preventDefault();
      const email = document.getElementById('leadEmail').value;
      try {
        const leads = JSON.parse(localStorage.getItem('jarvis_leads_${esc(slug)}') || '[]');
        leads.push({ email, capturedAt: new Date().toISOString() });
        localStorage.setItem('jarvis_leads_${esc(slug)}', JSON.stringify(leads));
      } catch (err) {}
      document.getElementById('leadMsg').style.display = 'block';
      document.getElementById('leadEmail').value = '';
    }
    function openCheckout(name, price) {
      document.getElementById('mTitle').textContent = name;
      document.getElementById('mPrice').textContent = price;
      document.getElementById('checkoutModal').style.display = 'grid';
    }
  </script>
</body>
</html>`;

    const playbook = `# ${brandName} — Online Business & Monetization Playbook

## 1. Ecosystem Value Ladder (Apps + Books + Courses)
1. **Free Lead Magnet (Top of Funnel)**: Free diagnostic / starter tier of **${featuredApp}** + Chapter 1 of *${featuredBook}*.
2. **Self-Liquidating Offer ($29)**: Digital + Audio bundle of *${featuredBook}* paired with 30-day Pro unlock of **${featuredApp}**.
3. **Core Revenue Engine ($297)**: **${featuredCourse}** — 6-module on-demand curriculum, templates, and annual app access.
4. **High-Ticket Recurring / B2B ($1,490+)**: Executive Cohort & Team App Licensing.

## 2. 5-Day Automated Email Sequence
- **Day 1 (Immediate)**: Delivery of Chapter 1 + Free App Login — *"The #1 Blindspot Holding Leaders Back"*
- **Day 2 (Value & Story)**: Case study showing how daily 5-minute leadership tracking compounds team trust.
- **Day 3 (Framework)**: Inside the 3-Pillar Transformational Leader OS.
- **Day 4 (Course & App Invitation)**: Why tools + training beat willpower alone (Enroll in ${featuredCourse}).
- **Day 5 (Fast-Action Bonus)**: Final 24-hour executive scorecard bonus & Q&A invite.

## 3. Monthly Revenue Projection Formula
- **1,000 monthly visitors** -> 25% opt-in = **250 new leads/mo**
- **12% Book + App Bundle ($29)** = $870/mo
- **6% Flagship Course ($297)** = $4,455/mo
- **2 Team / Advisory Cohorts ($1,490)** = $2,980/mo
- **Estimated Baseline Run-Rate**: **$8,305/month ($99,660/year)**
`;

    return {
      category: 'business',
      title: brandName,
      slug,
      summary: `Integrated funnel uniting "${featuredApp}", "${featuredBook}", and "${featuredCourse}".`,
      files: {
        'index.html': html,
        'LAUNCH-PLAYBOOK.md': playbook
      },
      data: { featuredApp, featuredBook, featuredCourse, heroPromise, tiers }
    };
  }

  /* =========================================================================
     3. LEADERSHIP BOOK ARCHITECT
     ========================================================================= */
  function buildBookPackage(input) {
    const title = input.title || titleCaseFromPrompt(input.prompt, 'Lead Under Pressure');
    const subtitle = input.subtitle || 'How Visionary Leaders Build Trust, Decisive Clarity, and Enduring Culture in an Age of Acceleration';
    const author = input.authorName || 'Founder';
    const slug = slugify(title);

    const chapters = input.chapters || [
      'Chapter 1: The Clarity Imperative — Leading When the Map Disappears',
      'Chapter 2: Self-Command Before Team Command',
      'Chapter 3: High-Velocity Decision Architecture',
      'Chapter 4: Radical Ownership & Psychological Courage',
      'Chapter 5: Communicating Vision That Mobilizes Action',
      'Chapter 6: Coaching Leaders Who Coach Leaders',
      'Chapter 7: Turning Adversity into Institutional Momentum',
      'Chapter 8: The Legacy Operating System'
    ];

    const chapter1Draft = input.manuscriptBody || `## ${chapters[0]}

Every defining season of leadership begins at the exact moment certainty runs out. When markets shift overnight, teams look past spreadsheets and titles—they look directly at the emotional and strategic steadiness of the person at the helm.

Most struggling organizations do not suffer from a shortage of talent or effort. They suffer from **decision fog**: competing priorities, unspoken assumptions, and reactive urgency masquerading as progress. Transformational leaders break that fog through three deliberate disciplines:

### 1. Anchor Reality Without Drama
Great leaders neither sugarcoat hard truths nor amplify panic. They separate *facts* from *narratives*. Begin every high-stakes review by asking: *"What do we know for certain today, what are we assuming, and what single variable matters most in the next 14 days?"*

### 2. Compress Strategy Onto One Page
If your team cannot repeat your top three priorities from memory, you do not yet have alignment—you have a wish list. Clarity scales only when complexity is distilled into plain, repeatable commitments.

### 3. Install Rhythms of Ownership
Culture is not built in annual retreats; it is forged in weekly cadences. When every leader owns a measurable outcome, commits publicly, and reviews progress transparently, accountability transforms from top-down pressure into shared pride.

---

### Monday Morning Leadership Lab
1. **Audit Your Top 5 Initiatives**: Eliminate or pause the bottom two that dilute focus this quarter.
2. **Run the 3-Question Alignment Check**: Ask three direct reports separately to name the team's #1 goal this month—compare their answers.
3. **Schedule 20 Minutes of Uninterrupted Strategic Thinking**: Protect thinking time on your calendar before reactive meetings claim your week.`;

    const fullMarkdown = `# ${title}
### *${subtitle}*
**By ${author}**

---

## Table of Contents
${chapters.map((c, i) => `${i + 1}. ${c}`).join('\n')}

---

${chapter1Draft}
`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} — Digital Manuscript</title>
  <style>
    body { margin: 0; background: #0b111e; color: #e2e8f0; font-family: 'Georgia', serif; display: grid; grid-template-columns: 290px 1fr; min-height: 100vh; }
    @media (max-width: 800px) { body { grid-template-columns: 1fr; } }
    aside { background: #070c16; border-right: 1px solid rgba(56,189,248,0.2); padding: 28px 22px; font-family: -apple-system, sans-serif; }
    main { max-width: 740px; padding: 52px 40px; line-height: 1.82; font-size: 18px; }
    h1 { font-size: 38px; line-height: 1.15; color: #fff; margin-bottom: 8px; }
    .sub { font-size: 19px; color: #94a3b8; font-style: italic; margin-bottom: 28px; }
    .toc-item { font-size: 13px; color: #94a3b8; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .print-btn { background: #0ea5e9; color: #04111f; border: none; padding: 9px 14px; border-radius: 8px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 16px; }
    h2, h3 { color: #38bdf8; font-family: -apple-system, sans-serif; margin-top: 28px; }
    blockquote { border-left: 3px solid #38bdf8; padding-left: 16px; color: #cbd5e1; }
    @media print { aside { display: none; } body { background: #fff; color: #111; display: block; } h1, h2, h3 { color: #000; } }
  </style>
</head>
<body>
  <aside>
    <div style="font-size:11px;letter-spacing:1.4px;color:#38bdf8;text-transform:uppercase;font-weight:700;">Leadership Book Studio</div>
    <div style="font-size:17px;font-weight:800;color:#fff;margin:8px 0 4px;">${esc(title)}</div>
    <div style="font-size:12px;color:#64748b;margin-bottom:20px;">By ${esc(author)}</div>
    ${chapters.map((c) => `<div class="toc-item">${esc(c)}</div>`).join('')}
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  </aside>
  <main>
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(subtitle)}</div>
    <div style="white-space: pre-wrap;">${esc(chapter1Draft)}</div>
  </main>
</body>
</html>`;

    return {
      category: 'books',
      title,
      slug,
      summary: subtitle,
      files: {
        'index.html': html,
        'MANUSCRIPT.md': fullMarkdown
      },
      data: { subtitle, author, chapters, manuscript: fullMarkdown }
    };
  }

  /* =========================================================================
     4. LEADERSHIP COURSE ARCHITECT
     ========================================================================= */
  function buildCoursePackage(input) {
    const title = input.title || titleCaseFromPrompt(input.prompt, 'The Executive Leadership Accelerator');
    const slug = slugify(title);
    const outcome = input.outcome || 'Equip emerging and senior leaders with a repeatable 6-week system for strategic clarity, team ownership, and high-trust execution.';

    const modules = input.modules || [
      { week: 'Module 1', title: 'Personal Mastery & Executive Presence', videoScript: 'Welcome to Module 1. Before you scale a team, you must architect your own energy, focus, and decision cadence...', exercise: 'Complete the 7-Day Time & Decision Audit Scorecard.' },
      { week: 'Module 2', title: 'Strategic Clarity & One-Page OKRs', videoScript: 'In Module 2, we strip away organizational noise and translate your 12-month vision into 3 non-negotiable 90-day outcomes...', exercise: 'Draft and share your One-Page Strategic Alignment Charter.' },
      { week: 'Module 3', title: 'High-Trust Communication & Candor', videoScript: 'Great cultures combine high psychological safety with high performance standards. Here is the exact conversation framework...', exercise: 'Deliver one high-candor, high-care feedback session this week.' },
      { week: 'Module 4', title: 'Delegation, Coaching & Multiplier Systems', videoScript: 'If every hard problem lands back on your desk, you have built a bottleneck. Let us install the 4-Level Ownership Ladder...', exercise: 'Transition two recurring operational decisions to emerging leaders.' },
      { week: 'Module 5', title: 'Leading Through Crisis & Rapid Change', videoScript: 'Turbulence is where credibility is earned. Learn the 48-hour stabilization protocol for uncertain markets...', exercise: 'Build your Pre-Mortem Risk & Rapid Response Playbook.' },
      { week: 'Module 6', title: 'Scaling Culture & Leadership Legacy', videoScript: 'In our final module, we turn individual habits into institutional rituals that endure across teams and years...', exercise: 'Finalize your 12-Month Leadership Operating Rhythm.' }
    ];

    const curriculumMd = `# ${title}
**Transformation Outcome**: ${outcome}

---

${modules.map((m) => `## ${m.week}: ${m.title}
- **Video Lesson Hook**: ${m.videoScript}
- **Action Lab Assignment**: ${m.exercise}
`).join('\n')}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} — Academy Portal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, sans-serif; }
    body { background: #060d1a; color: #f1f5f9; display: grid; grid-template-columns: 310px 1fr; min-height: 100vh; }
    @media (max-width: 820px) { body { grid-template-columns: 1fr; } }
    aside { background: #091528; border-right: 1px solid rgba(56,189,248,0.22); padding: 24px; }
    .mod-btn { width: 100%; text-align: left; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #e2e8f0; padding: 12px; border-radius: 10px; margin-bottom: 9px; cursor: pointer; }
    .mod-btn.active { border-color: #38bdf8; background: rgba(56,189,248,0.14); }
    main { padding: 40px; max-width: 860px; }
    .video-stage { background: linear-gradient(135deg, #0d2240, #050c18); border: 1px solid rgba(56,189,248,0.35); border-radius: 16px; padding: 34px; margin: 20px 0; }
    .lab-box { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.4); border-radius: 12px; padding: 20px; margin-top: 18px; }
    button.complete { margin-top: 18px; padding: 11px 20px; border-radius: 8px; border: none; background: #10b981; color: #031c14; font-weight: 800; cursor: pointer; }
  </style>
</head>
<body>
  <aside>
    <div style="font-size:11px;color:#38bdf8;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;">Course Academy Portal</div>
    <h2 style="font-size:18px;margin:8px 0 6px;">${esc(title)}</h2>
    <div id="progText" style="font-size:12px;color:#94a3b8;margin-bottom:18px;">0 / ${modules.length} Modules Completed</div>
    <div id="modList"></div>
  </aside>
  <main>
    <div id="lessonStage"></div>
  </main>
  <script>
    const MODS = ${JSON.stringify(modules)};
    const KEY = 'jarvis_course_${esc(slug)}';
    let done = {};
    try { done = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
    let current = 0;

    function selectMod(i) { current = i; render(); }
    function toggleDone(i) {
      done[i] = !done[i];
      try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) {}
      render();
    }
    function render() {
      const completedCount = Object.values(done).filter(Boolean).length;
      document.getElementById('progText').textContent = completedCount + ' / ' + MODS.length + ' Modules Completed';
      document.getElementById('modList').innerHTML = MODS.map((m, i) => \`
        <button class="mod-btn \${i === current ? 'active' : ''}" onclick="selectMod(\${i})">
          <div style="font-size:11px;color:#38bdf8;">\${m.week} \${done[i] ? '✓' : ''}</div>
          <div style="font-weight:600;font-size:13.5px;margin-top:2px;">\${m.title}</div>
        </button>
      \`).join('');

      const m = MODS[current];
      document.getElementById('lessonStage').innerHTML = \`
        <div style="font-size:12px;color:#38bdf8;text-transform:uppercase;font-weight:700;">\${m.week}</div>
        <h1 style="font-size:30px;margin-top:4px;">\${m.title}</h1>
        <div class="video-stage">
          <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">TELEPROMPTER & LESSON SCRIPT</div>
          <p style="font-size:16.5px;line-height:1.7;">"\${m.videoScript}"</p>
        </div>
        <div class="lab-box">
          <div style="font-size:12px;color:#34d399;font-weight:700;text-transform:uppercase;margin-bottom:6px;">Leadership Action Lab</div>
          <p style="font-size:15px;">\${m.exercise}</p>
        </div>
        <button class="complete" onclick="toggleDone(\${current})">\${done[current] ? 'Completed ✓ (Click to Undo)' : 'Mark Module Complete'}</button>
      \`;
    }
    render();
  </script>
</body>
</html>`;

    return {
      category: 'courses',
      title,
      slug,
      summary: outcome,
      files: {
        'index.html': html,
        'CURRICULUM.md': curriculumMd
      },
      data: { outcome, modules, curriculumMd }
    };
  }

  return {
    slugify,
    buildAppPackage,
    buildBusinessPackage,
    buildBookPackage,
    buildCoursePackage
  };
})();
