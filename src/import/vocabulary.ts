// The words, symbols and units that name each field of a catalogue rating table, in the languages catalogues are printed
// in. Kept as data: a new language or a vendor's own wording is a line here, not new code. Words are matched whole after
// folding case and accents, longest phrase first ("power factor" before "power"); a heading word cut short ("Curr",
// "Insul") matches the word it begins. Symbols and units are matched as printed, because case carries meaning there:
// "A" and "In" are amps, the word "a" or "in" in a sentence is not.
export type Field='kw'|'w'|'hp'|'in'|'un'|'eff'|'pf'|'speed'|'poles'|'name'|'code'|'frame'|'skip';

const WORDS:Record<Field,readonly string[]>={
 kw:['output','rated output','power','rated power','nominal power','shaft power','motor power','leistung','nennleistung','bemessungsleistung','abgabeleistung',
  'puissance','puissance nominale','puissance utile','potencia','potencia nominal','potencia útil','potenza','potenza nominale','potenza resa','potência nominal',
  'vermogen','nominaal vermogen','moc','moc znamionowa','güç','anma gücü','nominal güç','мощность','номинальная мощность','功率','额定功率','输出功率'],
 w:[],
 hp:['horsepower','horse power'],
 in:['current','rated current','nominal current','full load current','full-load current','amps','amperes','fla','flc','strom','nennstrom','bemessungsstrom',
  'stromaufnahme','courant','courant nominal','intensité','intensité nominale','corriente','corriente nominal','intensidad','intensidad nominal','corrente',
  'corrente nominale','stroom','nominale stroom','prąd','prąd znamionowy','akım','nominal akım','anma akımı','ток','номинальный ток','电流','额定电流'],
 un:['voltage','rated voltage','nominal voltage','volts','volt','spannung','nennspannung','bemessungsspannung','tension','tension nominale','tensión nominal',
  'voltaje','tensione','tensione nominale','tensão','tensão nominal','spanning','napięcie','gerilim','напряжение','电压','额定电压'],
 eff:['efficiency','eff','effic','wirkungsgrad','rendement','rendimiento','eficiencia','rendimento','efficienza','eficiência','sprawność','verim','кпд','效率'],
 pf:['power factor','pf','p f','cos','cosφ','cos φ','cos phi','cosphi','leistungsfaktor','facteur de puissance','factor de potencia','fattore di potenza',
  'fator de potência','arbeidsfactor','vermogensfactor','współczynnik mocy','güç faktörü','коэффициент мощности','功率因数'],
 speed:['speed','rated speed','nominal speed','rpm','r min','rev min','min 1','1 min','drehzahl','nenndrehzahl','u min','vitesse','tr min','velocidad',
  'velocità','velocidade','rotação','toerental','prędkość obrotowa','obroty','devir','hız','частота вращения','скорость','об мин','转速','额定转速'],
 poles:['poles','pole','polig','pôles','polos','poli','polen','biegunów','kutup','полюсов','полюса','极数'],
 // A type or series name, the model a load list picks.
 name:['type','model','motor type','series','designation','type designation','typ','typenbezeichnung','bezeichnung','baureihe','modèle','désignation',
  'type moteur','tipo','modelo','serie','série','modello','tipo motore','reeks','seria','tip','тип','модель','серия','型号','型式','系列'],
 // A code that tells one rated product from the next: part, article or order number.
 code:['id','product id','product code','product no','ident','ident no','article','article no','art no','order no','order code','ordering code',
  'order number','part no','part number','catalogue no','catalog no','cat no','mlfb','reference','item no','bestellnummer','bestell nr','artikelnummer',
  'artikel nr','sachnummer','référence','code article','código','referencia','codice','codice articolo','referência','bestelnummer','numer katalogowy',
  'indeks','kod','ürün kodu','sipariş kodu','артикул','код','订货号','物料号','订货编号'],
 frame:['frame','frame size','size','frame no','baugröße','bg','achshöhe','carcasse','taille','hauteur d axe','tamaño','carcasa','grandezza','carcassa',
  "altezza d'asse",'carcaça','tamanho','bouwgrootte','wielkość mechaniczna','gövde','габарит','机座号','机座'],
 // Not load data: starting and no-load values, ratios, torque, inertia, weight, noise, classes, sizes, prices, pump duty.
 skip:['torque','starting','start','locked','locked rotor','no load','idle','ratio','inertia','moment of inertia','weight','mass','noise','sound',
  'sound pressure','pressure','slip','temperature','temp','class','insulation','bearing','bearings','dimension','dimensions','price','qty','quantity',
  'limit','minimum','rotor','flow','head','lra','breakdown','pull out','pull up','drehmoment','moment','anlauf','anzug','leerlauf','trägheitsmoment',
  'gewicht','masse','geräusch','schalldruck','lager','preis','couple','démarrage','à vide','inertie','poids','bruit','roulement','prix','par','arranque',
  'vacío','inercia','peso','ruido','rodamiento','precio','coppia','avviamento','spunto','vuoto','inerzia','rumore','cuscinetto','prezzo','binário',
  'conjugado','partida','inércia','ruído','koppel','aanloop','geluid','rozruch','masa','hałas','tork','kalkış','ağırlık','gürültü','момент','пуск',
  'пусковой','масса','шум','转矩','扭矩','启动','起动','堵转','空载','转动惯量','重量','质量','噪声','噪音'],
};
// Symbols and units, as printed. φ, η and the look-alike letters some fonts use for them are unified first.
const SIGNS:readonly [Field,RegExp][]=[
 ['skip',/\b[IiMmTt]\s?[A-Za-z]{0,3}\s?\/\s?[IiMmTt]\s?[A-Za-z]{0,3}\b|\bI\s?(?:0|o|nl|NL)\b|\bNm\b|\bkg|\bdB|\bmm\b|°C|\bpu\b|\bIP\s?\d/],
 ['kw',/(^|[^A-Za-z])[kK]W($|[^A-Za-z])|(^|[^A-Za-z])P\s?[nN2r]($|[^A-Za-z])/],
 ['w',/(^|[\s(\[])W($|[\s)\]])/],
 ['hp',/(^|[^A-Za-z])(?:HP|hp|Hp)($|[^A-Za-z])/],
 ['in',/(^|[\s(\[])A($|[\s)\]])|(^|[^A-Za-z])I\s?(?:[nN]|fl|FL|r)($|[^A-Za-z])/],
 ['un',/(^|[\s(\[])k?V($|[\s)\]])|(^|[^A-Za-z])U\s?[nN]($|[^A-Za-z])/],
 ['eff',/η/],
 ['pf',/cos\s*φ/i],
 ['speed',/r\s?\/\s?min|\brpm\b|min\s?-\s?1|\b1\s?\/\s?min|\b[Uu]\s?\/\s?min|tr\s?\/\s?min/i],
];
const unify=(s:string)=>s.replace(/[ɸϕΦ]/g,'φ').replace(/[ƞȠ]/g,'η').normalize('NFKC');
// Lower case, accents off, punctuation to spaces (keeping %, φ and η): the form words are compared in.
export const fold=(s:string)=>` ${unify(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}%φη]+/gu,' ').trim()} `;
const HAN=/\p{Script=Han}/u;
const PHRASES=Object.entries(WORDS).flatMap(([f,ws])=>ws.map(w=>({field:f as Field,folded:fold(w).trim()}))).sort((a,b)=>b.folded.length-a.folded.length);
const SINGLE=PHRASES.filter(p=>!p.folded.includes(' ')&&p.folded.length>=6&&!HAN.test(p.folded));
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const PATTERNS=PHRASES.map(p=>({...p,re:HAN.test(p.folded)?new RegExp(esc(p.folded),'g'):new RegExp(` ${esc(p.folded).replace(/ /g,'  ')} `,'g')}));

// How strongly a heading line names each field. Each phrase counts once and uses up its words, so "power factor"
// does not also count as "power".
export function fieldsIn(line:string):Map<Field,number> {
 const raw=unify(line),out=new Map<Field,number>(),add=(f:Field,n:number)=>out.set(f,(out.get(f)??0)+n);
 for(const [f,re] of SIGNS)if(re.test(raw))add(f,1);
 // Spaces are doubled so that neighbouring words each keep the space on both sides that whole-word matching needs.
 let text=fold(raw).replace(/ /g,'  ');
 for(const p of PATTERNS){p.re.lastIndex=0;if(!p.re.test(text))continue;add(p.field,1+0.2*p.folded.split(' ').length);text=text.replace(p.re,'  ');}
 for(const word of text.split(' '))if(word.length>=4&&!/\d/.test(word)){const hit=SINGLE.find(p=>p.folded.startsWith(word)&&p.folded!==word);if(hit)add(hit.field,0.6);}
 return out;
}
