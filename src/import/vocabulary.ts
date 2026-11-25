// The words, symbols and units that name each field of a catalogue rating table, in the languages catalogues are printed
// in. Kept as data: a new language or a vendor's own wording is a line here, not new code. Words are matched whole after
// folding case and accents, longest phrase first ("power factor" before "power"); a heading word cut short ("Curr",
// "Insul") matches the word it begins. Symbols and units are matched as printed, because case carries meaning there:
// "A" and "In" are amps, the word "a" or "in" in a sentence is not.
// hz, mass, ip and ie name a parameter a catalogue prints beside the load data (supply frequency, weight, IP code,
// efficiency class); the load-data readers treat them as not load data.
export type Field='kw'|'w'|'hp'|'in'|'un'|'eff'|'pf'|'speed'|'poles'|'name'|'code'|'frame'|'hz'|'mass'|'ip'|'ie'|'skip';

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
 name:['type','model','motor type','model number','model no','model code','motor model','type number','type no','series','designation','type designation','typ','typenbezeichnung','bezeichnung','baureihe','modèle','désignation',
  'type moteur','tipo','modelo','serie','série','modello','tipo motore','reeks','seria','tip','тип','модель','серия','型号','型式','系列'],
 // A code that tells one rated product from the next: part, article or order number.
 code:['id','product id','product code','product no','ident','ident no','article','article no','art no','order no','order code','ordering code',
  'order number','part no','part number','catalogue no','catalog no','catalogue number','catalog number','cat no','product number','material number','mlfb','reference','item no','bestellnummer','bestell nr','artikelnummer',
  'artikel nr','sachnummer','référence','code article','código','referencia','codice','codice articolo','referência','bestelnummer','numer katalogowy',
  'indeks','kod','ürün kodu','sipariş kodu','артикул','код','订货号','物料号','订货编号'],
 frame:['frame','frame size','size','frame no','baugröße','bg','achshöhe','carcasse','taille','hauteur d axe','tamaño','carcasa','grandezza','carcassa',
  "altezza d'asse",'carcaça','tamanho','bouwgrootte','wielkość mechaniczna','gövde','габарит','机座号','机座'],
 // Supply frequency, weight, IP code and efficiency class: each a parameter of its own, not load data.
 hz:['frequency','freq','rated frequency','supply frequency','nominal frequency','mains frequency','frequenz','netzfrequenz','nennfrequenz','fréquence',
  'frecuencia','frequenza','frequência','frequentie','częstotliwość','frekans','частота','频率'],
 mass:['weight','mass','net weight','gross weight','approx weight','motor weight','gewicht','nettogewicht','masse','poids','poids net','peso','peso neto',
  'peso netto','massa','masa','ağırlık','масса','вес','重量','质量','净重'],
 ip:['ip rating','ip code','ip class','degree of protection','protection degree','ingress protection','enclosure rating','schutzart','schutzgrad',
  'indice de protection','degré de protection','grado de protección','grado di protezione','grau de proteção','beschermingsgraad','stopień ochrony',
  'koruma sınıfı','степень защиты','防护等级'],
 ie:['ie class','ie cl','ie code','efficiency class','eff class','energy efficiency class','efficiency level','wirkungsgradklasse','effizienzklasse',
  'energieeffizienzklasse','classe de rendement','clase de eficiencia','classe di efficienza','classe de rendimento','rendementsklasse','klasa sprawności',
  'verimlilik sınıfı','класс энергоэффективности','能效等级'],
 // Not load data: starting and no-load values, ratios, torque, inertia, weight, noise, classes, sizes, prices, pump duty.
 skip:['torque','starting','start','locked','locked rotor','no load','idle','ratio','inertia','moment of inertia','noise','sound',
  'sound pressure','pressure','slip','temperature','temp','class','insulation','bearing','bearings','dimension','dimensions','price','qty','quantity',
  'limit','minimum','rotor','flow','head','lra','breakdown','pull out','pull up','drehmoment','moment','anlauf','anzug','leerlauf','trägheitsmoment',
  'geräusch','schalldruck','lager','preis','couple','démarrage','à vide','inertie','bruit','roulement','prix','par','arranque',
  'vacío','inercia','ruido','rodamiento','precio','coppia','avviamento','spunto','vuoto','inerzia','rumore','cuscinetto','prezzo','binário',
  'conjugado','partida','inércia','ruído','koppel','aanloop','geluid','rozruch','hałas','tork','kalkış','gürültü','момент','пуск',
  'пусковой','шум','转矩','扭矩','启动','起动','堵转','空载','转动惯量','噪声','噪音'],
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
 // "Hz" or a lone "f" over a column; "50 Hz" in a title is the table's supply, not a heading.
 ['hz',/(?<![\d.,]\s?)\bHz\b|(?:^|[\s(\[])f\s?[nN]?(?:$|[\s)\]])/],
 ['mass',/(?<![\d.,]\s?)\b(?:kg|lbs?)\b(?![\s·.*]?m)/],
 // In capitals only: "Ie" and "Ip" are a current. "IE3" and "IP55" are values, not headings.
 ['ip',/(?<![A-Za-z])IP(?![A-Za-z\d]|\s\d)/],
 ['ie',/(?<![A-Za-z])IE(?![A-Za-z\d]|\s\d)/],
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

// The words that head a model, type, part or order number, for readers that find them in running text.
export const ID_WORDS:readonly string[]=[...WORDS.name,...WORDS.code];
const topOf=(f:ReadonlyMap<Field,number>)=>[...f].sort((a,b)=>b[1]-a[1])[0]?.[0];
// The fields that name one parameter on their own. Power, current or voltage do not: "Output current" is not "Input current".
const NAMES_ONE=new Set<Field>(['hz','mass','ip','ie','speed','poles','frame']);
// The thing a parameter's label names, when the vocabulary knows it: "Weight" is mass, "Efficiency class (IE)" is ie.
export const conceptOf=(label:string):Field|undefined=>{const t=topOf(fieldsIn(label));return t&&NAMES_ONE.has(t)?t:undefined;};
// Codes with a fixed shape: an IP code is IP and two digits (or X for an untested one), an efficiency class IE and a digit.
export const SHAPES:Partial<Record<Field,readonly [RegExp,(m:RegExpMatchArray)=>string]>>={
 ip:[/(?<![A-Za-z])IP\s?([0-6X])\s?([0-9X])(?!\d)/i,m=>`IP${m[1]}${m[2]}`.toUpperCase()],
 ie:[/(?<![A-Za-z])IE\s?-?\s?([0-5])(?![\d.,])/,m=>`IE${m[1]}`],
};

// Load points, as fractions of full load, in the order printed: "100 %", "100/75/50 %", "4/4", "1/1", "3/4", "FL", "full
// load", "half load". A fraction is of small whole numbers, so a ratio of quantities ("Ia/In") or a dual rating ("230/400")
// is none. Words are matched like heading words, longest first ("three quarter load" is not also "quarter load").
const LOADS:readonly [number,readonly string[]][]=[
 [1,['full load','fullload','fl','f l','rated load','nominal load','volllast','vollast','pleine charge','plena carga','pieno carico','volle belasting',
  'pełne obciążenie','tam yük','полная нагрузка','满载','满负荷']],
 [0.75,['three quarter load','three quarters load']],
 [0.5,['half load','halblast','demi charge','media carga','metà carico','meia carga','halve belasting','połowa obciążenia','yarım yük','половинная нагрузка','半载']],
 [0.25,['quarter load']],
 [0,['no load','noload','idle','leerlauf','à vide','en vacío','a vuoto','em vazio','nullast','bieg jałowy','boşta','холостой ход','空载']],
];
// The word for load after a percentage ("100 % load", "75 % Last"), as a pattern for readers of running text.
export const LOAD_NOUNS=['load','last','charge','carga','carico','belasting','obciążenia','yük','нагрузке','нагрузка','负载','负荷'].join('|');
const LOAD_WORDS=LOADS.flatMap(([v,ws])=>ws.map(w=>{const f=fold(w).trim();return {v,len:f.length,re:new RegExp(HAN.test(f)?esc(f):` ${esc(f).replace(/ /g,'  ')} `,'g')};})).sort((a,b)=>b.len-a.len);
// bare: the text is a heading cell, where a lone number ("100", "75") under an efficiency or power factor is a load point too.
export function loadsIn(text:string,bare=false):number[] {
 const raw=unify(text),at:[number,number][]=[];
 for(const m of raw.matchAll(/(?<![\d.,/])([1-8])\s*\/\s*([1-8])(?![\d.,/])/g)){const v=+m[1]!/+m[2]!;if(v<=1.25)at.push([m.index,v]);}
 for(const m of raw.matchAll(/(?<![\d.,])\d{2,3}(?:\s*(?:\/|,|-|–|and|und|et|y)\s*\d{2,3})*\s*%/g))
  for(const n of m[0].matchAll(/\d{2,3}/g)){const v=+n[0]/100;if(v>=0.1&&v<=1.25)at.push([m.index+n.index,v]);}
 if(bare&&!at.length&&/^\s*\d{2,3}\s*$/.test(raw)){const v=+raw.trim()/100;if(v>=0.1&&v<=1.25)at.push([0,v]);}
 // Words come after figures: the two are rarely printed together, and folding moves the words' positions.
 let words=fold(raw).replace(/ /g,'  ');const said:[number,number][]=[];
 for(const p of LOAD_WORDS){for(const m of words.matchAll(p.re))said.push([m.index,p.v]);words=words.replace(p.re,'  ');}
 return [...at.sort((a,b)=>a[0]-b[0]),...said.sort((a,b)=>a[0]-b[0])].map(x=>x[1]);
}

// Units as printed, each as the quantity it measures and its size in that quantity's base unit: a weight printed in lb is
// converted for a parameter in kg, a power in hp for one in kW. Matched as printed; units of two letters or more also in
// other capitals ("KW", "Kg"), single letters only as printed ("A" is amps, "a" is not).
const UNITS:Record<string,readonly [string,number]>={W:['W',1],kW:['W',1e3],MW:['W',1e6],hp:['W',745.7],VA:['VA',1],kVA:['VA',1e3],MVA:['VA',1e6],
 var:['var',1],kvar:['var',1e3],Mvar:['var',1e6],A:['A',1],mA:['A',1e-3],kA:['A',1e3],V:['V',1],kV:['V',1e3],Hz:['Hz',1],kHz:['Hz',1e3],
 kg:['kg',1],g:['kg',1e-3],t:['kg',1e3],lb:['kg',0.45359237],lbs:['kg',0.45359237],rpm:['rpm',1],'r/min':['rpm',1],'min-1':['rpm',1],'1/min':['rpm',1],
 '%':['%',1],s:['s',1],ms:['s',1e-3],min:['s',60],h:['s',3600],mm:['m',1e-3],cm:['m',1e-2],m:['m',1],Nm:['Nm',1],kNm:['Nm',1e3],dB:['dB',1],
 'dB(A)':['dB',1],lm:['lm',1],'lm/W':['lm/W',1],'l/h':['l/h',1],'°C':['°C',1]};
const LOWER=new Map(Object.keys(UNITS).filter(u=>u.length>1).map(u=>[u.toLowerCase(),u] as const));
const unitOf=(u:string)=>{const k=UNITS[u]?u:u.length>1?LOWER.get(u.toLowerCase()):undefined;return k?{token:u,base:UNITS[k]![0],size:UNITS[k]![1]}:undefined;};
const KEYS=Object.keys(UNITS).sort((a,b)=>b.length-a.length).map(esc).join('|');
const WITH_NUMBER=new RegExp(`(?<![\\p{L}\\d.,])\\d+(?:[.,]\\d+)?(?:\\s*(?:[-–/…]|\\.{2,3})\\s*\\d+(?:[.,]\\d+)?)*\\s*(${KEYS})(?![\\p{L}\\d])`,'giu');
// alone: a unit printed in a heading ("Weight (kg)", "Speed [rpm]", "Current / A", or "kg" on a line of its own), not the
// end of another unit ("r/min").
const ALONE=new RegExp(`(?:^|[(\\[]\\s*|\\s\\/\\s*)(${KEYS})\\s*(?:$|[)\\]])`,'giu');
const unitsIn=(text:string,alone=false)=>(alone?text.split('\n').flatMap(l=>[...l.trim().matchAll(ALONE)]):[...text.matchAll(WITH_NUMBER)]).flatMap(m=>{const u=unitOf(m[1]!);return u?[u]:[];});

// Optimal string alignment distance: one letter missed, added, changed or two swapped is one edit, the slips of OCR and
// hurried typing. Letters OCR takes for each other (0 and o, 1 and l…) cost half an edit.
const LOOKALIKE=new Set(['0o','1l','1i','il','5s','8b','6g','2z']);
export function edits(a:string,b:string):number {
 const d=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i||j));
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
  const x=a[i-1]!,y=b[j-1]!,sub=x===y?0:LOOKALIKE.has(x<y?x+y:y+x)?0.5:1,row=d[i]!,up=d[i-1]!;
  row[j]=Math.min(up[j]!+1,row[j-1]!+1,up[j-1]!+sub);
  if(i>1&&j>1&&x===b[j-2]&&a[i-2]===y)row[j]=Math.min(row[j]!,d[i-2]![j-2]!+1);
 }
 return d[a.length]![b.length]!;
}
// A printed word x for a label word w: the same, cut short ("Freq.", "Eff."), a plural, or (in a long word) one slip.
const sameWord=(w:string,x:string)=>w===x||x.length>=3&&w.startsWith(x)||w.length>=4&&x.startsWith(w)&&x.length<=w.length+2||
 Math.min(w.length,x.length)>=7&&edits(w,x)<=(w.length>=10?2:1);
// Words that say nothing about which parameter it is.
const STOP=new Set(['rated','nominal','max','maximum','min','minimum','typical','typ','approx','approximately','at','of','the','per','and','or','in',
 'for','with','to','by','on','an']);
const wordsOf=(s:string)=>fold(s.replace(/\S*\/\S*/g,' ')).trim().split(' ').filter(w=>w.length>1&&!STOP.has(w));
// A ratio of two quantities ("Ia/In", "Is/I n", "M m /M n") as the numerator's letter over the denominator: "i/in".
// A capital I and a small l look alike in most fonts (OCR reads "In" as "ln"), so they count as one letter.
export const ratioOf=(s:string)=>s.replace(/\s*\/\s*/g,'/').replace(/\b([A-Za-z])\s([a-z0-9]{1,3})\b/g,'$1$2').match(/(?<![A-Za-z])([A-Za-z])[A-Za-z0-9]{0,3}\/([A-Za-z][A-Za-z0-9]{0,3})(?![A-Za-z])/)?.slice(1).join('/').toLowerCase().replace(/l/g,'i')??'';

// How surely a printed label names a parameter, 0 when it does not. own: the label, or the heading over a table column
// alone; head: with the lines spanning it; value: what is printed beside the label. A label names the parameter by the
// thing both name (frequency, weight, IP code, efficiency class, speed, poles, frame), or by the parameter's own words
// with more found than missing or added ("Input current" is not "Output current", "Normal duty power" not "Heavy-duty
// power"); a ratio ("Is/In" for "Ia/In") counts twice. A unit printed for another quantity rules it out, as does a value
// without the shape the parameter's codes have.
export function nameScore(p:{label:string;unit:string},own:string,head=own,value=''):number {
 const concept=conceptOf(p.label),field=!!concept&&fieldsIn(head).has(concept);
 const want=wordsOf(p.label),have=wordsOf(head),mine=wordsOf(own),ratio=ratioOf(p.label);
 const found=want.filter(w=>have.some(x=>sameWord(w,x))).length,hits=found+(ratio&&(ratioOf(own)===ratio||ratioOf(head)===ratio)?2:0);
 const added=mine.filter(x=>x.length>=3&&!want.some(w=>sameWord(w,x))).length;
 if(!field&&hits-added-(want.length-found)<=0)return 0;
 const unit=unitOf(p.unit.trim()),printed=[...unitsIn(value),...unitsIn(own,true)],agrees=!!unit&&printed.some(u=>u.base===unit.base);
 if(printed.length&&!agrees)return 0;
 const shape=concept&&SHAPES[concept];
 if(shape&&value&&!shape[0].test(value))return 0;
 return (field?3:0)+hits+(agrees?2:0)+(shape&&value?1:0);
}
// A parameter's value as printed, in the parameter's unit: "84 lb" for a weight in kg is 38.102, "IP 55" is IP55, "50/60
// Hz" is 50/60. A value in a unit of another quantity (amps for a ratio) is none. context: the heading the value is
// printed under, for its unit. was: the value as printed, when it was converted.
export function valueIn(p:{label:string;unit:string},text:string,context=''):{value:string;was?:string}|null {
 const t=text.trim().replace(/(\d),(\d)/g,'$1.$2');if(!t)return null;
 const concept=conceptOf(p.label),shape=concept&&SHAPES[concept];
 if(shape){const m=t.match(shape[0]);return m?{value:shape[1](m)}:null;}
 const unit=unitOf(p.unit.trim()),printed=unitsIn(t)[0]??unitsIn(context,true)[0];
 if(printed&&printed.base!==unit?.base)return null;
 if(!unit)return {value:/^[-+]?\d+(?:\.\d+)?$/.test(t)?String(Number(t)):t};
 const n=t.match(/\d+(?:\.\d+)?(?:\s*(?:[-–/…]|\.{2,3})\s*\d+(?:\.\d+)?)*/)?.[0].replace(/\s+/g,'').replace(/–|…|\.{2,3}/g,'-');if(!n)return null;
 const size=printed?printed.size/unit.size:1;
 if(size===1)return {value:n};
 return {value:n.replace(/\d+(?:\.\d+)?/g,x=>String(+(Number(x)*size).toFixed(3))),was:`${n} ${printed!.token}`};
}
