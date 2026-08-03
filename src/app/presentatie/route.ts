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
    position:relative;
    width:min(96vw, calc(96vh * 16 / 9));
    height:min(96vh, calc(96vw * 9 / 16));
    background:var(--paper);
    box-shadow:0 20px 60px rgba(0,0,0,.45);
    overflow:hidden;
  }
  .slide{
    position:absolute;inset:0;
    padding:5.5% 7%;
    display:none;
    flex-direction:column;
  }
  .slide.active{display:flex}
  .kicker{
    font-family:"Helvetica Neue",Arial,sans-serif;
    font-size:1.05vw;letter-spacing:.18em;text-transform:uppercase;
    color:var(--accent);font-weight:700;margin-bottom:1.6vh;
  }
  h1{font-size:4.6vw;line-height:1.05;letter-spacing:-.02em;font-weight:400}
  h2{font-size:3.1vw;line-height:1.1;letter-spacing:-.015em;font-weight:400;margin-bottom:2.6vh}
  .sub{font-size:1.5vw;color:var(--muted);line-height:1.45;max-width:80%}
  p,li{font-size:1.45vw;line-height:1.55}
  ul{list-style:none;margin-top:1vh}
  li{margin-bottom:1.9vh;padding-left:1.6vw;position:relative}
  li::before{content:"";position:absolute;left:0;top:.85vw;width:.55vw;height:.55vw;background:var(--accent)}
  li b{font-weight:700}
  .lede{font-size:1.7vw;line-height:1.5;margin-bottom:2.5vh;max-width:88%}
  .cols{display:flex;gap:4%;margin-top:1vh}
  .cols>div{flex:1}
  .cols h3{font-family:"Helvetica Neue",Arial,sans-serif;font-size:1.05vw;letter-spacing:.12em;
    text-transform:uppercase;color:var(--accent);margin-bottom:1.2vh}
  .flow{display:flex;gap:1.2%;margin-top:2vh}
  .step{flex:1;background:#fff;border-top:.35vw solid var(--accent);padding:2vh 1.2vw;}
  .step .n{font-family:"Helvetica Neue",Arial,sans-serif;font-size:.95vw;letter-spacing:.12em;
    color:var(--muted);text-transform:uppercase}
  .step .t{font-size:1.5vw;margin:.6vh 0 1vh;font-weight:700}
  .step .d{font-size:1.05vw;line-height:1.45;color:#3a3f47}
  .stats{display:flex;gap:3%;margin-top:2vh}
  .stat{flex:1;border-left:.25vw solid var(--line);padding-left:1.4vw}
  .stat .big{font-size:4vw;line-height:1;color:var(--accent)}
  .stat .lbl{font-size:1.1vw;color:var(--muted);margin-top:1vh;line-height:1.4}
  .quote{font-size:2.2vw;line-height:1.35;font-style:italic;max-width:85%}
  .foot{margin-top:auto;font-family:"Helvetica Neue",Arial,sans-serif;
    font-size:.95vw;color:var(--muted);border-top:1px solid var(--line);padding-top:1.4vh;
    display:flex;justify-content:space-between}
  .tag{display:inline-block;background:var(--ink);color:var(--paper);
    font-family:"Helvetica Neue",Arial,sans-serif;font-size:.9vw;letter-spacing:.1em;
    text-transform:uppercase;padding:.5vh .8vw;margin-bottom:2vh}
  .nav{position:fixed;bottom:1.5vh;right:2vw;font-family:"Helvetica Neue",Arial,sans-serif;
    color:#8b9099;font-size:12px;user-select:none}
  .nav b{color:#e6e2da}
  @media print{
    body{background:#fff;display:block}
    #deck{width:100%;height:100vh;box-shadow:none}
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
    <p class="sub" style="margin-top:2.5vh">Een lokale nieuwsredactie die volledig door AI-agents wordt gedraaid.<br>
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
      <li>Verhuisd naar <b>Claude Cowork</b>, waar je taken op een klok kunt zetten. Elke agent wordt een dienst op de redactie: 00:10, 01:00, 02:00, 06:00, 07:00.</li>
      <li>Concrete vraag geworden: <b>kan een site volledig zelfstandig nieuws over Amersfoort publiceren?</b></li>
      <li>De eerste versie stond binnen een paar dagen. Dat is precies het interessante — én het verwarrende.</li>
    </ul>
    <div class="foot"><span>Stadsgeest</span><span>2</span></div>
  </section>

  <!-- 3 -->
  <section class="slide">
    <div class="kicker">Wat het is</div>
    <h2>Een redactie zonder mensen erin</h2>
    <div class="cols" style="margin-top:1vh">
      <div>
        <h3>Wat er gebeurt</h3>
        <p>Elke nacht en elke middag doorloopt de site dezelfde stappen die een redactie doorloopt: verzamelen, wegen, uitzoeken, schrijven, publiceren. Zonder dat iemand op een knop drukt.</p>
        <p style="margin-top:2vh">Ik heb de instructies geschreven — niet de artikelen.</p>
      </div>
      <div>
        <h3>Randvoorwaarden</h3>
        <ul style="margin-top:0">
          <li>Volledig <b>transparant</b> over het AI-karakter.</li>
          <li>Alle content <b>vrij herbruikbaar</b>.</li>
          <li>Gericht op bronnen waar <b>anderen niet naar kijken</b> — geen concurrent van lokale media.</li>
          <li>Nu nog <b>afgeschermd met wachtwoord</b>: experimenteerfase.</li>
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
      <div class="step"><div class="n">00:10</div><div class="t">Intake</div><div class="d">Alles wat de scrapers ophaalden wordt geordend. Losse berichten worden gebundeld tot &ldquo;signalen&rdquo;: dit hoort bij elkaar.</div></div>
      <div class="step"><div class="n">01:00</div><div class="t">Speurder</div><div class="d">Weegt de signalen. Is dit nieuw? Is er meer dan één bron? Schreven we hier al eens over? Kiest maximaal drie kandidaten.</div></div>
      <div class="step"><div class="n">02:00</div><div class="t">Researcher</div><div class="d">Zoekt context: eerdere berichtgeving, betrokken personen en organisaties, reacties uit de wijk.</div></div>
      <div class="step"><div class="n">06:00</div><div class="t">Schrijver</div><div class="d">Schrijft het stuk, publiceert het, zet de bronnen eronder. Bij nieuw nieuws over een oud verhaal: update in plaats van nieuw artikel.</div></div>
      <div class="step"><div class="n">07:00</div><div class="t">Designer</div><div class="d">Zoekt beeld en bepaalt de indeling van de voorpagina.</div></div>
    </div>
    <p style="margin-top:2.5vh;font-size:1.25vw;color:var(--muted)">Elke dienst geeft het werk door aan de volgende via een database — net als een redactiesysteem. Op werkdagen draait de hele reeks een tweede keer, 's middags.</p>
    <div class="foot"><span>Stadsgeest</span><span>4</span></div>
  </section>

  <!-- 5 -->
  <section class="slide">
    <div class="kicker">De bronnen</div>
    <h2>Waar het interessant wordt</h2>
    <p class="lede">De ambitie zit niet in het schrijven. Die zit in de bronnen die te taai zijn om dagelijks door te spitten.</p>
    <div class="cols">
      <div>
        <h3>Voorbeelden</h3>
        <ul style="margin-top:0">
          <li>Aanbestedingen (TenderNed), subsidieregisters, jaarverslagen</li>
          <li>Rechtspraak.nl, officiële bekendmakingen, B&amp;W-besluiten</li>
          <li>Raadsstukken: moties, schriftelijke vragen, ingekomen post</li>
          <li>Inspecties (IGJ, NVWA), CBS-cijfers, UWV, omgevingsdienst</li>
        </ul>
      </div>
      <div>
        <h3>Bronladder</h3>
        <p><b>Tier 1</b> — publicatiebronnen: op zichzelf al een verhaal.<br>
        <b>Tier 2</b> — bevestiging: gemeente, corporaties, hulpdiensten.<br>
        <b>Tier 3</b> — signalen: sociale media, andere media, 112. Alleen aanleiding, nooit de basis.</p>
        <p style="margin-top:1.6vh;color:var(--muted);font-size:1.2vw">Ruim honderd bronnen geregistreerd, waarvan een kleine vijftig dagelijks of wekelijks wordt opgehaald.</p>
      </div>
    </div>
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
    <p style="margin-top:4vh;font-size:1.4vw;max-width:85%">De verhouding is het verhaal: van ruim drieduizend documenten blijft uiteindelijk een paar dozijn artikel over. Het filter werkt. De vraag is of het de <i>juiste</i> dingen doorlaat.</p>
    <div class="foot"><span>Stadsgeest &middot; stand per zomer 2026</span><span>6</span></div>
  </section>

  <!-- 7 -->
  <section class="slide">
    <div class="kicker">Eerlijk</div>
    <h2>Waar het schuurt</h2>
    <ul>
      <li><b>De dwarsverbanden blijven uit.</b> Het idee was: verbanden leggen die een redactie niet kan zien omdat het te veel tijd kost. De praktijk: veel eendimensionale berichten, te vaak gebaseerd op één bron. De machine vindt nieuws, maar zelden een <i>verhaal</i>.</li>
      <li><b>Beeld is een echt probleem.</b> Vrije beeldbanken leveren zelden iets dat past bij lokaal nieuws. Grafieken kunnen alleen bij harde cijfers, kaartjes alleen bij plaatsgebonden nieuws. AI-beeld op een nieuwssite vind ik onacceptabel — misleidend. Er is geen goede oplossing.</li>
      <li><b>Het kost geld.</b> Vijf tot tien agentdiensten per dag verbruiken serieus wat rekencapaciteit. De site staat inmiddels grotendeels gepauzeerd, en gaat af en toe aan om te testen.</li>
      <li><b>En dit ook:</b> stille fouten. Scrapers die een week stilstonden zonder dat iemand het merkte, koppelingen die honderden losse berichten aan één verhaal plakten. Een redactie zonder mensen mist ook de mens die zegt: dit klopt niet.</li>
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
        <p>Een site die zelf publiceert. Eindproduct. Lezer als doelgroep. Beeld, opmaak en voorpagina moeten kloppen.</p>
      </div>
      <div>
        <h3>Wordt</h3>
        <p><b>Grondstof, geen eindproduct.</b> Signalen uit taaie bronnen, met vindplaats en context erbij, klaar om door een redactie opgepakt te worden. Het proces zelf zo inzichtelijk mogelijk: waar komt dit vandaan, waarom denkt het systeem dat dit iets is.</p>
        <p style="margin-top:1.6vh">Beeld en voorpagina zijn dan andermans probleem — en dat scheelt precies het stuk dat niet werkt.</p>
      </div>
    </div>
    <div class="foot"><span>Stadsgeest</span><span>8</span></div>
  </section>

  <!-- 9 -->
  <section class="slide">
    <div class="kicker">Waarom dit gesprek</div>
    <h2>Liever samen dan alleen</h2>
    <p class="quote">Ik weet vrij precies wat het systeem kan.<br>Ik weet niet of wat eruit komt bruikbaar is voor iemand die echt een stad verslaat.</p>
    <ul style="margin-top:4vh">
      <li>Welke bronnen zou je willen laten doorspitten als tijd geen rol speelde?</li>
      <li>Wat maakt een signaal voor jullie bruikbaar — en wat maakt het onbruikbaar?</li>
      <li>In welke vorm zou je zoiets willen ontvangen? Mail, feed, lijstje, iets anders?</li>
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
