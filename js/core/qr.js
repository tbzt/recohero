/* ==========================================================================
   qr.js — un code QR, écrit à la main.

   Pourquoi à la main : une affiche à coller dans les rayons a besoin d'un
   QR code, et le projet n'a pas de dépendances. Une bibliothèque de plus
   coûterait la promesse « ça tourne depuis une clé USB » pour une
   quarantaine de kilo-octets ; l'algorithme, lui, tient en trois cents
   lignes et ne bouge plus jamais — la norme a trente ans.

   Périmètre volontairement étroit : mode OCTET, correction de niveau M,
   versions 1 à 10. Cela couvre 216 octets, soit n'importe quelle adresse
   de questionnaire, espace et paramètres compris. Le reste de la norme
   (numérique, alphanumérique, kanji, versions 11 à 40) n'a pas d'emploi
   ici et serait du code que personne n'exécute.

   Le niveau M plutôt que L : une affiche se froisse, se salit et prend le
   soleil. M récupère 15 % du symbole, L seulement 7.

   Fonctions pures, aucun DOM — comme scoring.js, et pour la même raison :
   ce qui se vérifie sans écran se vérifie vraiment.
   ========================================================================== */

/* --- Le corps fini GF(256) ---------------------------------------------------
   Arithmétique de Reed-Solomon, polynôme primitif 0x11D (celui de la norme
   QR). Les tables d'exponentielles sont doublées pour éviter un modulo à
   chaque multiplication.                                                   */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/* g(x) = ∏ (x − α^i), i de 0 à degré−1. En base 2, soustraire c'est ajouter. */
function genPoly(degre) {
  let poly = [1];
  for (let i = 0; i < degre; i += 1) {
    const suivant = new Array(poly.length + 1).fill(0);
    for (let k = 0; k < poly.length; k += 1) {
      suivant[k] ^= poly[k];
      suivant[k + 1] ^= mul(poly[k], EXP[i]);
    }
    poly = suivant;
  }
  return poly;
}

/* Le reste de la division du message par g(x) : les octets de correction. */
function correction(donnees, longueur) {
  const gen = genPoly(longueur);
  const reste = new Uint8Array(donnees.length + longueur);
  reste.set(donnees);
  for (let i = 0; i < donnees.length; i += 1) {
    const facteur = reste[i];
    if (facteur === 0) continue;
    for (let j = 0; j < gen.length; j += 1) reste[i + j] ^= mul(gen[j], facteur);
  }
  return reste.slice(donnees.length);
}

/* Les syndromes d'un mot de code : tous nuls si le mot est valide. C'est le
   contrôle indépendant du codeur — il ne partage aucune ligne avec lui, et
   une table de correction fausse s'y voit immédiatement. Exporté parce
   qu'un algorithme qu'on ne peut pas éprouver n'est pas fini. */
export function syndromes(motDeCode, longueurCorrection) {
  const sortie = [];
  for (let i = 0; i < longueurCorrection; i += 1) {
    let s = 0;
    for (const octet of motDeCode) s = mul(s, EXP[i]) ^ octet;
    sortie.push(s);
  }
  return sortie;
}

/* --- Les versions, au niveau M -----------------------------------------------
   `total` : tous les octets du symbole. `ec` : octets de correction PAR bloc.
   `blocs` : [nombre de blocs, octets de données par bloc].                  */

const VERSIONS = {
  1:  { total: 26,  ec: 10, blocs: [[1, 16]] },
  2:  { total: 44,  ec: 16, blocs: [[1, 28]] },
  3:  { total: 70,  ec: 26, blocs: [[1, 44]] },
  4:  { total: 100, ec: 18, blocs: [[2, 32]] },
  5:  { total: 134, ec: 24, blocs: [[2, 43]] },
  6:  { total: 172, ec: 16, blocs: [[4, 27]] },
  7:  { total: 196, ec: 18, blocs: [[4, 31]] },
  8:  { total: 242, ec: 22, blocs: [[2, 38], [2, 39]] },
  9:  { total: 292, ec: 22, blocs: [[3, 36], [2, 37]] },
  10: { total: 346, ec: 26, blocs: [[4, 43], [1, 44]] },
};

const ALIGNEMENTS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function octetsDeDonnees(version) {
  const v = VERSIONS[version];
  return v.blocs.reduce((somme, [n, taille]) => somme + n * taille, 0);
}

/* --- BCH ---------------------------------------------------------------------
   Les blocs d'information — format et version — portent leur propre
   correction. On la calcule plutôt que de recopier vingt constantes : une
   table se transcrit mal, une division polynomiale ne se trompe pas. */

function bch(valeur, generateur, bitsTotal, bitsData) {
  let reste = valeur << (bitsTotal - bitsData);
  const hautGen = 32 - Math.clz32(generateur);
  for (let i = bitsTotal; i >= hautGen; i -= 1) {
    if (reste & (1 << (i - 1))) reste ^= generateur << (i - hautGen);
  }
  return ((valeur << (bitsTotal - bitsData)) | reste) >>> 0;
}

/* Niveau M = 0b00. Cinq bits (niveau + masque), quinze au total, puis un
   ou-exclusif imposé par la norme pour qu'un symbole tout blanc ne donne
   pas un format valide. */
function infoFormat(masque) {
  return (bch((0b00 << 3) | masque, 0b101_0011_0111, 15, 5) ^ 0b101_0100_0001_0010) >>> 0;
}

/* Seules les versions 7 et au-delà portent leur numéro dans le symbole. */
function infoVersion(version) {
  return bch(version, 0b1_1111_0010_0101, 18, 6) >>> 0;
}

/* --- Le train de bits -------------------------------------------------------- */

function versLesOctets(texte) {
  return new TextEncoder().encode(texte);
}

function choisirVersion(nbOctets) {
  for (let v = 1; v <= 10; v += 1) {
    const bitsCompte = v < 10 ? 8 : 16;
    const bitsNecessaires = 4 + bitsCompte + nbOctets * 8;
    if (bitsNecessaires <= octetsDeDonnees(v) * 8) return v;
  }
  return null;
}

function encoderDonnees(octets, version) {
  const bits = [];
  const pousser = (valeur, longueur) => {
    for (let i = longueur - 1; i >= 0; i -= 1) bits.push((valeur >> i) & 1);
  };

  pousser(0b0100, 4);                                   /* mode octet */
  pousser(octets.length, version < 10 ? 8 : 16);        /* nombre de caractères */
  for (const o of octets) pousser(o, 8);

  const capacite = octetsDeDonnees(version) * 8;
  /* Terminateur : quatre zéros, ou moins s'il ne reste pas la place. */
  for (let i = 0; i < 4 && bits.length < capacite; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const mots = [];
  for (let i = 0; i < bits.length; i += 8) {
    mots.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  }
  /* Remplissage : 0xEC et 0x11 en alternance, comme l'impose la norme. */
  const remplissage = [0xec, 0x11];
  for (let i = 0; mots.length < octetsDeDonnees(version); i += 1) {
    mots.push(remplissage[i % 2]);
  }
  return mots;
}

/* Les blocs sont entrelacés : un octet de chaque bloc à tour de rôle, puis
   la correction de chaque bloc de la même façon. C'est ce qui fait qu'une
   tache sur l'affiche abîme un peu tous les blocs plutôt que d'en détruire
   un seul — et qu'aucun n'est perdu. */
function entrelacer(mots, version) {
  const { ec, blocs } = VERSIONS[version];
  const donnees = [];
  const corrections = [];
  let curseur = 0;

  for (const [nombre, taille] of blocs) {
    for (let i = 0; i < nombre; i += 1) {
      const bloc = mots.slice(curseur, curseur + taille);
      curseur += taille;
      donnees.push(bloc);
      corrections.push(correction(Uint8Array.from(bloc), ec));
    }
  }

  const sortie = [];
  const plusLong = Math.max(...donnees.map((b) => b.length));
  for (let i = 0; i < plusLong; i += 1) {
    for (const bloc of donnees) if (i < bloc.length) sortie.push(bloc[i]);
  }
  for (let i = 0; i < ec; i += 1) {
    for (const bloc of corrections) sortie.push(bloc[i]);
  }
  return { flux: sortie, donnees, corrections };
}

/* --- La trame ---------------------------------------------------------------- */

function motifPositionnement(m, reserve, ligne, colonne, taille) {
  for (let dl = -1; dl <= 7; dl += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const l = ligne + dl;
      const c = colonne + dc;
      if (l < 0 || l >= taille || c < 0 || c >= taille) continue;
      const bord = dl === 0 || dl === 6 || dc === 0 || dc === 6;
      const coeur = dl >= 2 && dl <= 4 && dc >= 2 && dc <= 4;
      const dedans = dl >= 0 && dl <= 6 && dc >= 0 && dc <= 6;
      m[l][c] = dedans && (bord || coeur) ? 1 : 0;
      reserve[l][c] = 1;
    }
  }
}

function motifAlignement(m, reserve, ligne, colonne) {
  for (let dl = -2; dl <= 2; dl += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      m[ligne + dl][colonne + dc] =
        Math.max(Math.abs(dl), Math.abs(dc)) !== 1 ? 1 : 0;
      reserve[ligne + dl][colonne + dc] = 1;
    }
  }
}

const MASQUES = [
  (l, c) => (l + c) % 2 === 0,
  (l) => l % 2 === 0,
  (_, c) => c % 3 === 0,
  (l, c) => (l + c) % 3 === 0,
  (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0,
  (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
  (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0,
  (l, c) => (((l + c) % 2) + ((l * c) % 3)) % 2 === 0,
];

/* Les quatre pénalités de la norme. Elles ne servent qu'à choisir le masque
   le moins mauvais : un symbole trop régulier, ou qui imite un motif de
   positionnement, se lit mal.                                             */
function penalite(m, taille) {
  let score = 0;

  /* 1 — suites de cinq modules ou plus de même teinte. */
  for (let i = 0; i < taille; i += 1) {
    for (const lireLigne of [true, false]) {
      let precedent = -1;
      let suite = 0;
      for (let j = 0; j < taille; j += 1) {
        const v = lireLigne ? m[i][j] : m[j][i];
        if (v === precedent) suite += 1;
        else { if (suite >= 5) score += 3 + (suite - 5); precedent = v; suite = 1; }
      }
      if (suite >= 5) score += 3 + (suite - 5);
    }
  }

  /* 2 — carrés de deux sur deux. */
  for (let l = 0; l < taille - 1; l += 1) {
    for (let c = 0; c < taille - 1; c += 1) {
      const v = m[l][c];
      if (v === m[l][c + 1] && v === m[l + 1][c] && v === m[l + 1][c + 1]) score += 3;
    }
  }

  /* 3 — le motif 1011101 précédé ou suivi de quatre modules clairs, qui
     imite un repère de positionnement. */
  const gabarits = [
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  ];
  for (let i = 0; i < taille; i += 1) {
    for (let j = 0; j + 11 <= taille; j += 1) {
      for (const gabarit of gabarits) {
        let ligneOk = true;
        let colonneOk = true;
        for (let k = 0; k < 11; k += 1) {
          if (m[i][j + k] !== gabarit[k]) ligneOk = false;
          if (m[j + k][i] !== gabarit[k]) colonneOk = false;
        }
        if (ligneOk) score += 40;
        if (colonneOk) score += 40;
      }
    }
  }

  /* 4 — l'écart à cinquante pour cent de modules sombres. */
  let sombres = 0;
  for (let l = 0; l < taille; l += 1) for (let c = 0; c < taille; c += 1) sombres += m[l][c];
  const pourcent = (sombres * 100) / (taille * taille);
  score += Math.floor(Math.abs(pourcent - 50) / 5) * 10;

  return score;
}

/* --- L'assemblage ------------------------------------------------------------- */

function trameNue(version) {
  const taille = version * 4 + 17;
  const m = Array.from({ length: taille }, () => new Uint8Array(taille));
  const reserve = Array.from({ length: taille }, () => new Uint8Array(taille));

  motifPositionnement(m, reserve, 0, 0, taille);
  motifPositionnement(m, reserve, 0, taille - 7, taille);
  motifPositionnement(m, reserve, taille - 7, 0, taille);

  const axes = ALIGNEMENTS[version];
  for (const l of axes) {
    for (const c of axes) {
      if (reserve[l][c]) continue;  /* pas par-dessus un repère de coin */
      motifAlignement(m, reserve, l, c);
    }
  }

  for (let i = 8; i < taille - 8; i += 1) {
    const v = i % 2 === 0 ? 1 : 0;
    m[6][i] = v; reserve[6][i] = 1;
    m[i][6] = v; reserve[i][6] = 1;
  }

  /* Le module toujours sombre, et les zones réservées à l'information. */
  m[taille - 8][8] = 1;
  reserve[taille - 8][8] = 1;
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) { reserve[8][i] = 1; reserve[i][8] = 1; }
  }
  for (let i = 0; i < 8; i += 1) {
    reserve[8][taille - 1 - i] = 1;
    reserve[taille - 1 - i][8] = 1;
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        reserve[i][taille - 11 + j] = 1;
        reserve[taille - 11 + j][i] = 1;
      }
    }
  }
  return { m, reserve, taille };
}

function poserLesDonnees(m, reserve, taille, flux) {
  const bits = [];
  for (const octet of flux) for (let i = 7; i >= 0; i -= 1) bits.push((octet >> i) & 1);

  let index = 0;
  let versLeHaut = true;
  for (let droite = taille - 1; droite >= 1; droite -= 2) {
    if (droite === 6) droite = 5;   /* la colonne 6 porte la synchronisation */
    for (let pas = 0; pas < taille; pas += 1) {
      for (let j = 0; j < 2; j += 1) {
        const colonne = droite - j;
        const ligne = versLeHaut ? taille - 1 - pas : pas;
        if (reserve[ligne][colonne]) continue;
        /* Au-delà du flux, les modules restent clairs : ce sont les bits de
           reste que la norme laisse libres. */
        m[ligne][colonne] = index < bits.length ? bits[index] : 0;
        index += 1;
      }
    }
    versLeHaut = !versLeHaut;
  }
}

function poserFormat(m, taille, masque) {
  const bits = infoFormat(masque);
  const lire = (i) => (bits >> i) & 1;

  for (let i = 0; i <= 5; i += 1) m[8][i] = lire(i);
  m[8][7] = lire(6);
  m[8][8] = lire(7);
  m[7][8] = lire(8);
  for (let i = 9; i <= 14; i += 1) m[14 - i][8] = lire(i);

  /* La seconde copie se répartit SEPT bits en bas à gauche et HUIT en haut
     à droite — pas huit et sept. Le huitième module de la colonne, en
     partant du bas, est le module toujours sombre, et il n'appartient pas
     au format : y écrire un bit l'éteint une fois sur deux.

     Le défaut ne se voyait pas à la relecture, parce qu'un lecteur écrit
     avec le même décalage retrouve exactement ce qu'on a posé. Il ne se
     voyait qu'au contrôle du module sombre — et un vrai lecteur, lui, y
     serait tombé, puisque c'est dans le format qu'il lit le masque. */
  for (let i = 0; i <= 6; i += 1) m[taille - 1 - i][8] = lire(i);
  for (let i = 7; i <= 14; i += 1) m[8][taille - 15 + i] = lire(i);
}

function poserVersion(m, taille, version) {
  if (version < 7) return;
  const bits = infoVersion(version);
  for (let i = 0; i < 18; i += 1) {
    const b = (bits >> i) & 1;
    const ligne = Math.floor(i / 3);
    const colonne = i % 3;
    m[ligne][taille - 11 + colonne] = b;
    m[taille - 11 + colonne][ligne] = b;
  }
}

/* --- L'entrée publique --------------------------------------------------------
   Rend une matrice de 0 et de 1, sans marge : c'est à l'appelant de laisser
   la marge blanche de quatre modules qu'exige la norme, parce que lui seul
   sait sur quel fond il dessine.                                          */

export function encoder(texte) {
  const octets = versLesOctets(String(texte));
  const version = choisirVersion(octets.length);
  if (!version) {
    throw new Error('Adresse trop longue pour un QR code de ce format (216 octets au plus).');
  }

  const mots = encoderDonnees(octets, version);
  const { flux, donnees, corrections } = entrelacer(mots, version);

  let meilleur = null;
  for (let masque = 0; masque < 8; masque += 1) {
    const { m, reserve, taille } = trameNue(version);
    poserLesDonnees(m, reserve, taille, flux);
    for (let l = 0; l < taille; l += 1) {
      for (let c = 0; c < taille; c += 1) {
        if (!reserve[l][c] && MASQUES[masque](l, c)) m[l][c] ^= 1;
      }
    }
    poserFormat(m, taille, masque);
    poserVersion(m, taille, version);

    const score = penalite(m, taille);
    if (!meilleur || score < meilleur.score) meilleur = { m, taille, score, masque };
  }

  return {
    modules: meilleur.m,
    taille: meilleur.taille,
    version,
    masque: meilleur.masque,
    /* De quoi éprouver le résultat sans le scanner : les blocs bruts et leur
       correction, dont les syndromes doivent tous être nuls. */
    blocs: donnees.map((bloc, i) => [...bloc, ...corrections[i]]),
    correctionParBloc: VERSIONS[version].ec,
  };
}
