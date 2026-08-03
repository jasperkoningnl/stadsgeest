export const dynamic = 'force-static'

const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Stadsgeest — van nieuwssite naar lokaal persbureau</title>
<style>
  :root{
    --ink:#12161c;
    --paper:#f6f4ef;
    --accent:#c8452f;
    --muted:#6c7280;
    --line:#d9d5cc;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    background:#22262c;
    font-family:"Georgia","Times New Roman",serif;
    color:var(--ink);
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;
  }
  #deck{
    /* 1 eenheid = 1% van de breedte van het dia-vlak, ongeacht vensterformaat */
    --u: min(1vw, 1.7778vh);
    position:relative;
    width:min(96vw, calc(96vh * 16 / 9));
    height:min(96vh, calc(96vw * 9 / 16));
    background:var(--paper);
    box-shadow:0 20px 60px rgba(0,0,0,.45);
    overflow:hidden;
  }
  .slide{
    position:absolute;inset:0;
    padding:calc(var(--u)*5) calc(var(--u)*6.5);
    display:none;
    flex-direction:column;
    overflow:hidden;
  }
  .slide.active{display:flex}
  .kicker{
    font-family:"Helvetica Neue",Arial,sans-serif;
    font-size:calc(var(--u)*1);letter-spacing:.18em;text-transform:uppercase;
    color:var(--accent);font-weight:700;margin-bottom:calc(var(--u)*1.2);
  }
  h1{font-size:calc(var(--u)*7.5);line-height:1.05;letter-spacing:-.02em;font-weight:400}
  h2{font-size:calc(var(--u)*4.4);line-height:1.1;letter-spacing:-.015em;font-weight:400;
     margin-bottom:calc(var(--u)*2.2)}
  .sub{font-size:calc(var(--u)*1.9);color:var(--muted);line-height:1.5;max-width:82%}
  p,li{font-size:calc(var(--u)*1.55);line-height:1.5}
  ul{list-style:none;margin-top:calc(var(--u)*.6)}
  li{margin-bottom:calc(var(--u)*1.5);padding-left:calc(var(--u)*1.7);position:relative}
  li::before{content:"";position:absolute;left:0;top:calc(var(--u)*.85);
    width:calc(var(--u)*.55);height:calc(var(--u)*.55);background:var(--accent)}
  li b{font-weight:700}
  .lede{font-size:calc(var(--u)*1.85);line-height:1.45;margin-bottom:calc(var(--u)*1.8);max-width:88%}
  .cols{display:flex;gap:4%;margin-top:calc(var(--u)*.4)}
  .cols>div{flex:1}
  .cols p{margin-bottom:calc(var(--u)*1.2)}
  .cols h3{font-family:"Helvetica Neue",Arial,sans-serif;font-size:calc(var(--u)*1);
    letter-spacing:.12em;text-transform:uppercase;color:var(--accent);
    margin-bottom:calc(var(--u)*1)}
  .flow{display:flex;gap:1.2%;margin-top:calc(var(--u)*1)}
  .step{flex:1;background:#fff;border-top:calc(var(--u)*.35) solid var(--accent);
    padding:calc(var(--u)*1.4) calc(var(--u)*1.1)}
  .step .n{font-family:"Helvetica Neue",Arial,sans-serif;font-size:calc(var(--u)*.9);
    letter-spacing:.12em;color:var(--muted);text-transform:uppercase}
  .step .t{font-size:calc(var(--u)*1.6);margin:calc(var(--u)*.5) 0 calc(var(--u)*.8);font-weight:700}
  .step .d{font-size:calc(var(--u)*1.1);line-height:1.4;color:#3a3f47}
  .stats{display:flex;gap:3%;margin-top:calc(var(--u)*1.5)}
  .stat{flex:1;border-left:calc(var(--u)*.25) solid var(--line);padding-left:calc(var(--u)*1.4)}
  .stat .big{font-size:calc(var(--u)*4.6);line-height:1;color:var(--accent)}
  .stat .lbl{font-size:calc(var(--u)*1.15);color:var(--muted);
    margin-top:calc(var(--u)*.9);line-height:1.35}
  .quote{font-size:calc(var(--u)*2.6);line-height:1.35;font-style:italic;max-width:86%}
  .note{font-size:calc(var(--u)*1.3);color:var(--muted);line-height:1.5}
  .foot{margin-top:auto;font-family:"Helvetica Neue",Arial,sans-serif;
    font-size:calc(var(--u)*.9);color:var(--muted);border-top:1px solid var(--line);
    padding-top:calc(var(--u)*1.1);display:flex;justify-content:space-between}
  .nav{position:fixed;bottom:1.5vh;right:2vw;font-family:"Helvetica Neue",Arial,sans-serif;
    color:#8b9099;font-size:12px;user-select:none}
  .nav b{color:#e6e2da}
  @media print{
    body{background:#fff;display:block}
    #deck{width:100%;height:100vh;box-shadow:none;--u:min(1vw,1.7778vh)}
    .slide{display:flex !important;page-break-after:always;position:relative;height:100vh}
    .nav{display:none}
  }
</style>
</head>
<body>
<div id="deck">

  <!-- 1 -->
  <section class="slide active">
    <div class="kicker">Amersfoort &middot; experiment 2026</div>
    <h1>Stadsgeest</h1>
    <p class="sub" style="margin-top:calc(var(--u)*2)">Een lokale nieuwsredactie die volledig door AI-agents wordt gedraaid.<br>
    En waarom het inmiddels geen nieuwssite meer wil zijn, maar een persbureau.</p>
    <div class="foot"><span>Jasper Koning</span><span>stadsgeest.nl</span></div>
  </section>

  <!-- 2 -->
  <section class="slide">
    <div class="kicker">Waar het begon</div>
    <h2>Kun je een redactie nabootsen?</h2>
    <p class="lede">Geen businessplan, geen gat in de markt. Eén vraag: als AI-agents zelfstandig taken kunnen uitvoeren — kun je er dan de rollen van een redactie mee nabouwen?</p>
    <ul>
      <li>Eerste tests met <b>OpenClaw</b>: losse agents die elkaar werk doorgeven.</li>
      <li>Verhuisd naar <b>Claude Cowork</b>, waar taken op een klok kunnen. Elke agent wordt een dienst op de redactie.</li>
      <li>Concrete vraag: <b>kan een site zelfstandig nieuws over Amersfoort publiceren?</b></li>
      <li>De eerste versie stond binnen een paar dagen.</li>
    </ul>
    <div class="foot"><span>Stadsgeest</span><span>2</span></div>
  </section>

  <!-- 3 -->
  <section class="slide">
    <div class="kicker">Wat het is</div>
    <h2>Een redactie zonder mensen erin</h2>
    <div class="cols">
      <div>
        <h3>Wat er gebeurt</h3>
        <p>Elke nacht en elke middag doorloopt de site dezelfde stappen als een redactie: verzamelen, wegen, uitzoeken, schrijven, publiceren. Zonder dat iemand op een knop drukt.</p>
        <p>Ik heb de instructies geschreven — niet de artikelen.</p>
      </div>
      <div>
        <h3>Randvoorwaarden</h3>
        <ul style="margin-top:0">
          <li>Volledig <b>transparant</b> over het AI-karakter.</li>
          <li>Alle content <b>vrij herbruikbaar</b>.</li>
          <li>Gericht op bronnen waar <b>anderen niet naar kijken</b>.</li>
          <li>Nu nog <b>afgeschermd</b>: experimenteerfase.</li>
        </ul>
      </div>
    </div>
    <div class="foot"><span>Stadsgeest</span><span>3</span></div>
  </section>

  <!-- 4 -->
  <section class="slide">
    <div class="kicker">Het proces</div>
    <h2>Vijf diensten, elke dag</h2>
    <div class="flow">
      <div class="step"><div class="n">00:10</div><div class="t">Intake</div><div class="d">Alles wat is opgehaald wordt geordend. Losse berichten worden gebundeld tot &ldquo;signalen&rdquo;.</div></div>
      <div class="step"><div class="n">01:00</div><div class="t">Speurder</div><div class="d">Weegt de signalen. Nieuw? Meer dan één bron? Al eens over geschreven? Kiest maximaal drie.</div></div>
      <div class="step"><div class="n">02:00</div><div class="t">Researcher</div><div class="d">Zoekt context: eerdere berichtgeving, betrokken personen en organisaties, reacties uit de wijk.</div></div>
      <div class="step"><div class="n">06:00</div><div class="t">Schrijver</div><div class="d">Schrijft, publiceert, zet de bronnen eronder. Nieuw nieuws over een oud verhaal wordt een update.</div></div>
      <div class="step"><div class="n">07:00</div><div class="t">Designer</div><div class="d">Zoekt beeld en bepaalt de indeling van de voorpagina.</div></div>
    </div>
    <p class="note" style="margin-top:calc(var(--u)*2)">Elke dienst geeft het werk door via een database — net als een redactiesysteem. Op werkdagen draait de reeks een tweede keer, 's middags.</p>
    <div class="foot"><span>Stadsgeest</span><span>4</span></div>
  </section>

  <!-- 5 -->
  <section class="slide">
    <div class="kicker">De bronnen</div>
    <h2>Waar het interessant wordt</h2>
    <p class="lede">De ambitie zit niet in het schrijven, maar in de bronnen die te taai zijn om dagelijks door te spitten.</p>
    <div class="cols">
      <div>
        <h3>Voorbeelden</h3>
        <ul style="margin-top:0">
          <li>Aanbestedingen, subsidieregisters, jaarverslagen</li>
          <li>Rechtspraak, bekendmakingen, B&amp;W-besluiten</li>
          <li>Raadsstukken: moties, vragen, ingekomen post</li>
          <li>Inspecties, CBS-cijfers, UWV, omgevingsdienst</li>
        </ul>
      </div>
      <div>
        <h3>Bronladder</h3>
        <p><b>Tier 1</b> — publicatiebronnen: op zichzelf al een verhaal.</p>
        <p><b>Tier 2</b> — bevestiging: gemeente, corporaties, hulpdiensten.</p>
        <p><b>Tier 3</b> — signalen: sociale media, andere media, 112. Alleen aanleiding, nooit de basis.</p>
      </div>
    </div>
    <p class="note" style="margin-top:calc(var(--u)*1.5)">Ruim honderd bronnen geregistreerd, waarvan een kleine vijftig dagelijks of wekelijks wordt opgehaald.</p>
    <div class="foot"><span>Stadsgeest</span><span>5</span></div>
  </section>

  <!-- 6 -->
  <section class="slide">
    <div class="kicker">Wat het opleverde</div>
    <h2>Cijfers na een paar maanden</h2>
    <div class="stats">
      <div class="stat"><div class="big">3.200+</div><div class="lbl">ruwe berichten en documenten opgehaald</div></div>
      <div class="stat"><div class="big">340+</div><div class="lbl">signalen gevormd — mogelijke verhalen</div></div>
      <div class="stat"><div class="big">~57</div><div class="lbl">daadwerkelijk gepubliceerde artikelen</div></div>
      <div class="stat"><div class="big">729</div><div class="lbl">personen en organisaties in de database</div></div>
    </div>
    <p style="margin-top:calc(var(--u)*3);max-width:88%">De verhouding is het verhaal: van ruim drieduizend documenten blijft een paar dozijn artikel over. Het filter werkt. De vraag is of het de <i>juiste</i> dingen doorlaat.</p>
    <div class="foot"><span>Stadsgeest &middot; stand per zomer 2026</span><span>6</span></div>
  </section>

  <!-- 7 -->
  <section class="slide">
    <div class="kicker">Eerlijk</div>
    <h2>Waar het schuurt</h2>
    <ul>
      <li><b>De dwarsverbanden blijven uit.</b> Het idee was verbanden leggen die een redactie niet ziet omdat het te veel tijd kost. De praktijk: eendimensionale berichten, te vaak op één bron. De machine vindt nieuws, maar zelden een <i>verhaal</i>.</li>
      <li><b>Beeld is een echt probleem.</b> Vrije beeldbanken leveren zelden iets passends. Grafieken alleen bij harde cijfers, kaartjes alleen bij plaatsgebonden nieuws. AI-beeld op een nieuwssite vind ik onacceptabel.</li>
      <li><b>Het kost geld.</b> Vijf tot tien agentdiensten per dag verbruiken serieus rekencapaciteit.</li>
      <li><b>Stille fouten.</b> Scrapers die een week stilstonden zonder dat iemand het merkte; koppelingen die honderden losse berichten aan één verhaal plakten.</li>
    </ul>
    <div class="foot"><span>Stadsgeest</span><span>7</span></div>
  </section>

  <!-- 8 -->
  <section class="slide">
    <div class="kicker">De stap</div>
    <h2>Van nieuwssite naar persbureau</h2>
    <p class="lede">Ik heb geen ambitie om een lokale nieuwssite draaiend te houden. En al helemaal niet om te concurreren met redacties die dat al doen — met mensen, met kennis van de stad.</p>
    <div class="cols">
      <div>
        <h3>Was</h3>
        <p>Een site die zelf publiceert. Eindproduct, lezer als doelgroep. Beeld, opmaak en voorpagina moeten kloppen.</p>
      </div>
      <div>
        <h3>Wordt</h3>
        <p><b>Grondstof, geen eindproduct.</b> Signalen uit taaie bronnen, met vindplaats en context, klaar om door een redactie opgepakt te worden. En het proces zelf inzichtelijk: waar komt dit vandaan, waarom denkt het systeem dat dit iets is.</p>
      </div>
    </div>
    <p class="note" style="margin-top:calc(var(--u)*1.2)">Beeld en voorpagina zijn dan andermans probleem — precies het stuk dat niet werkt.</p>
    <div class="foot"><span>Stadsgeest</span><span>8</span></div>
  </section>

  <!-- 9 -->
  <section class="slide">
    <div class="kicker">Waarom dit gesprek</div>
    <h2>Liever samen dan alleen</h2>
    <p class="quote">Ik weet vrij precies wat het systeem kan.<br>Ik weet niet of wat eruit komt bruikbaar is voor iemand die echt een stad verslaat.</p>
    <ul style="margin-top:calc(var(--u)*3)">
      <li>Welke bronnen zou je willen laten doorspitten als tijd geen rol speelde?</li>
      <li>Wat maakt een signaal bruikbaar — en wat maakt het onbruikbaar?</li>
      <li>In welke vorm zou je zoiets willen ontvangen?</li>
    </ul>
    <div class="foot"><span>Jasper Koning &middot; stadsgeest.nl</span><span>9</span></div>
  </section>

</div>
<div class="nav">← →  <b><span id="cur">1</span></b> / <span id="tot">9</span></div>
<script>
  const slides=[...document.querySelectorAll('.slide')];
  let i=0;
  document.getElementById('tot').textContent=slides.length;
  function go(n){
    i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach((s,k)=>s.classList.toggle('active',k===i));
    document.getElementById('cur').textContent=i+1;
  }
  document.addEventListener('keydown',e=>{
    if(['ArrowRight','ArrowDown',' ','PageDown'].includes(e.key)){e.preventDefault();go(i+1)}
    if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();go(i-1)}
    if(e.key==='Home')go(0);
    if(e.key==='End')go(slides.length-1);
  });
  document.addEventListener('click',e=>{go(e.clientX < window.innerWidth/2 ? i-1 : i+1)});
</script>
</body>
</html>
`

export async function GET() {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
