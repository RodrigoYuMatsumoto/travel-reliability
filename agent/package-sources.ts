import type { PackageProviderId } from '../schema/src/package-discovery.js';
import { AppError } from '../api/src/errors.js';

/** Operator-supplied source locations; no commercial fact or supplier certification. */
export const packageSourceCatalog = Object.freeze([
  Object.freeze({ id: 'atrativa' as const, name: 'Atrativa Tur', domain: 'atrativatur.com.br' }),
  Object.freeze({
    id: 'niel' as const,
    name: 'Niel Turismo',
    domain: 'nielturismo.suareservaonline.com.br',
  }),
  Object.freeze({
    id: 'viajantes-do-valle' as const,
    name: 'Viajantes do Valle',
    domain: 'www.viajantesdovalle.com.br',
  }),
  Object.freeze({
    id: 'augustus' as const,
    name: 'Augustus Turismo',
    domain: 'augustusturismo.com.br',
  }),
]);

export interface PackageSourceReference {
  id: string;
  label: string;
  providerId: PackageProviderId;
  kind: 'catalog' | 'package' | 'social_hint';
  browserUrl: string;
  fetchUrl: string | null;
  access: 'static_html' | 'rendered_snapshot' | 'social_hint';
}

const reference = (
  id: string,
  providerId: PackageProviderId,
  kind: PackageSourceReference['kind'],
  url: string,
): Readonly<PackageSourceReference> => {
  const browserUrl = new URL(url).href;
  const access =
    kind === 'social_hint'
      ? 'social_hint'
      : new URL(url).hash
        ? 'rendered_snapshot'
        : 'static_html';
  const labels: Record<string, string> = {
    'atrativa-instagram': 'Perfil comercial — pista de descoberta',
    'atrativa-date-catalog': 'Catálogo por data informada',
    'atrativa-1822': 'Porto de Galinhas / Maragogi — referência',
    'atrativa-1823': 'Aracaju — referência',
    'atrativa-1840': 'Morro de São Paulo — referência',
    'niel-instagram': 'Perfil comercial — pista de descoberta',
    'niel-december-catalog': 'Catálogo de dezembro — ano a confirmar',
    'niel-morro': 'Morro de São Paulo',
    'niel-aracaju': 'Aracaju / Sergipe',
    'niel-porto-reveillon': 'Réveillon — Porto de Galinhas e Maragogi',
    'niel-aracaju-reveillon': 'Réveillon — Aracaju e Reserva Boa Luz',
    'valle-instagram': 'Perfil comercial — pista de descoberta',
    'valle-catalog-page-2': 'Catálogo — segunda página informada',
    'valle-aracaju-christmas': 'Natal — Aracaju e litoral sergipano',
    'valle-canyons-reveillon': 'Réveillon — Cânions do São Francisco',
    'valle-salvador-reveillon': 'Réveillon — Salvador, Praia do Forte e Guarajuba',
    'valle-recife-reveillon': 'Réveillon — Recife, Porto, Maragogi e Carneiros',
    'valle-sao-luis-reveillon': 'Réveillon — São Luís e Lençóis Maranhenses',
    'valle-vitoria-reveillon': 'Réveillon — Vitória, Vila Velha e Guarapari',
    'augustus-instagram': 'Perfil comercial — pista de descoberta',
    'augustus-morro-christmas': 'Natal — Morro de São Paulo',
    'augustus-porto-christmas': 'Natal — Porto de Galinhas e Maragogi',
    'augustus-morro-reveillon': 'Réveillon — Morro de São Paulo',
    'augustus-fortaleza-reveillon': 'Réveillon — Fortaleza, Canoa e Morro Branco',
  };
  return Object.freeze({
    id,
    label: labels[id]!,
    providerId,
    kind,
    browserUrl,
    fetchUrl: access === 'static_html' ? browserUrl : null,
    access,
  });
};

export const packageReferenceCatalog = Object.freeze([
  reference(
    'atrativa-instagram',
    'atrativa',
    'social_hint',
    'https://www.instagram.com/atrativatur/',
  ),
  reference(
    'atrativa-date-catalog',
    'atrativa',
    'catalog',
    'https://atrativatur.com.br/viagem.php?local=&data=30%2F12%2F2026',
  ),
  reference('atrativa-1822', 'atrativa', 'package', 'https://atrativatur.com.br/viagem.php?v=1822'),
  reference('atrativa-1823', 'atrativa', 'package', 'https://atrativatur.com.br/viagem.php?v=1823'),
  reference('atrativa-1840', 'atrativa', 'package', 'https://atrativatur.com.br/viagem.php?v=1840'),
  reference('niel-instagram', 'niel', 'social_hint', 'https://www.instagram.com/nielturismo/'),
  reference(
    'niel-december-catalog',
    'niel',
    'catalog',
    'https://nielturismo.suareservaonline.com.br/44051?mes=12&destino=&category=&embarque=305',
  ),
  reference(
    'niel-morro',
    'niel',
    'package',
    'https://nielturismo.suareservaonline.com.br/pacote/morro-de-sao-paulo-uid146/44051',
  ),
  reference(
    'niel-aracaju',
    'niel',
    'package',
    'https://nielturismo.suareservaonline.com.br/pacote/aracaju-sergipe-uid143/44051',
  ),
  reference(
    'niel-porto-reveillon',
    'niel',
    'package',
    'https://nielturismo.suareservaonline.com.br/pacote/reveillon-porto-de-galinhas-maragogi-uid209/44051',
  ),
  reference(
    'niel-aracaju-reveillon',
    'niel',
    'package',
    'https://nielturismo.suareservaonline.com.br/pacote/reveillon-aracaju-reserva-boa-luz-uid208/44051',
  ),
  reference(
    'valle-instagram',
    'viajantes-do-valle',
    'social_hint',
    'https://www.instagram.com/viajantesdovalle',
  ),
  reference(
    'valle-catalog-page-2',
    'viajantes-do-valle',
    'catalog',
    'https://www.viajantesdovalle.com.br/home?offset=9&limit=9',
  ),
  reference(
    'valle-aracaju-christmas',
    'viajantes-do-valle',
    'package',
    'https://www.viajantesdovalle.com.br/home/DEZEMBRO-24-12-a-27-12-Aracaju-&-Praias-do-Litoral-Sergipano-SE-Feriad%C3%A3o-de-Natal-03-dias-02-noites-p817212843',
  ),
  reference(
    'valle-canyons-reveillon',
    'viajantes-do-valle',
    'package',
    'https://www.viajantesdovalle.com.br/home/DEZEMBRO-30-12-a-03-01-R%C3%A9veillon-nos-Canyons-do-Rio-S%C3%A3o-Francisco-AL-BA-p534200553',
  ),
  reference(
    'valle-salvador-reveillon',
    'viajantes-do-valle',
    'package',
    'https://www.viajantesdovalle.com.br/home/DEZEMBRO-30-12-a-03-01-R%C3%A9veillon-em-Salvador-Praia-do-Forte-&-Guarajuba-BA-p817777079',
  ),
  reference(
    'valle-recife-reveillon',
    'viajantes-do-valle',
    'package',
    'https://www.viajantesdovalle.com.br/home/DEZEMBRO-30-12-a-03-01-R%C3%A9veillon-em-Recife-Porto-de-Galinhas-Maragogi-&-Carneiros-Festa-da-Virada-em-Boa-Viagem-p874559759',
  ),
  reference(
    'valle-sao-luis-reveillon',
    'viajantes-do-valle',
    'package',
    'https://www.viajantesdovalle.com.br/home/DEZEMBRO-30-12-a-03-01-R%C3%A9veillon-em-S%C3%A3o-Lu%C3%ADs-&-Len%C3%A7%C3%B3is-Maranhenses-MA-p160694785',
  ),
  reference(
    'valle-vitoria-reveillon',
    'viajantes-do-valle',
    'package',
    'https://www.viajantesdovalle.com.br/home/DEZEMBRO-29-12-a-03-01-R%C3%A9veillon-em-Vit%C3%B3ria-Vila-Velha-&-Guarapari-ES-p140683962',
  ),
  reference(
    'augustus-instagram',
    'augustus',
    'social_hint',
    'https://www.instagram.com/augustusturismo/',
  ),
  reference(
    'augustus-morro-christmas',
    'augustus',
    'package',
    'https://augustusturismo.com.br/#/pacote/morro-de-sao-paulo-natal-2026-619-2026-12-23',
  ),
  reference(
    'augustus-porto-christmas',
    'augustus',
    'package',
    'https://augustusturismo.com.br/#/pacote/porto-de-galinhas-e-maragogi-849-2026-12-23',
  ),
  reference(
    'augustus-morro-reveillon',
    'augustus',
    'package',
    'https://augustusturismo.com.br/#/pacote/reveillon-morro-de-sao-paulo-1299-2026-12-30',
  ),
  reference(
    'augustus-fortaleza-reveillon',
    'augustus',
    'package',
    'https://augustusturismo.com.br/#/pacote/reveillon-fortaleza-canoa-m-branco-1290-2026-12-30',
  ),
]);

export function packageSourceById(id: unknown): Readonly<PackageSourceReference> {
  if (typeof id !== 'string') throw new AppError('PACKAGE_SOURCE_REJECTED', 422);
  const found = packageReferenceCatalog.find((item) => item.id === id);
  if (!found) throw new AppError('PACKAGE_SOURCE_REJECTED', 422);
  return found;
}

export function packageSourceUrl(id: unknown): URL {
  const source = packageSourceById(id);
  if (!source.fetchUrl) throw new AppError('PACKAGE_ASSISTED_SOURCE_REQUIRED', 422);
  return new URL(source.fetchUrl);
}
