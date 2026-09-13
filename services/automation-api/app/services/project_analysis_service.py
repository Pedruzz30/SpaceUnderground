"""Deterministic, server-side analysis of a project row.

This is not a port of the Admin's `projectHealth`. That function answers an
editor's question -- "is this record finished enough to publish?" -- and is
scoped to the form currently on screen. This one answers an operator's
question: "is what is in the database coherent, and would it behave correctly
if the site rendered it right now?"

The difference shows up in the rules. Only this side checks that the editorial
status agrees with visibility, that `live_preview_enabled` agrees with
`preview_url`, that a published row actually carries `published_at`, and how
long it has been since anything changed. None of those are things the form can
see, and duplicating the form's per-field completeness here would create a
second source of truth for a question the Admin already answers.

No AI and no heuristics that drift between runs: the same row always produces
the same result.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from app.schemas.common import AnalysisStatus, CheckStatus
from app.schemas.project import AnalysisCheck, ProjectAnalysis
from app.utils.dates import days_since

# Mirrors the check constraints in migration 001. Kept here so a row edited
# outside the Admin is reported rather than trusted.
VALID_CATEGORIES = {"Website", "System", "Automation", "AI", "Other"}
VALID_STATUSES = {"Live", "Prototype", "MVP", "Pilot", "In Development", "Research", "Archived"}
VALID_EDITORIAL = {"DRAFT", "PUBLISHED", "ARCHIVED"}

PRESENTATION_FIELDS = (
    "presentation_system",
    "presentation_label",
    "presentation_address",
    "presentation_type",
)

TRANSLATABLE_FIELDS = ("description", *PRESENTATION_FIELDS)

# A description shorter than this reads as a placeholder on the public card.
MIN_DESCRIPTION_LENGTH = 80

# Past this, a published case is worth revisiting. Not a failure: several real
# cases are finished work that simply has not changed.
STALE_AFTER_DAYS = 180

SCORE_PENALTY = {CheckStatus.FAIL: 12, CheckStatus.WARN: 4, CheckStatus.OK: 0}


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _is_http_url(value: Any) -> bool:
    """Whether a value is a URL a browser could actually load.

    Anything that is not http/https is rejected, which is what keeps a
    `javascript:` value from ever being treated as a demo.
    """
    raw = _text(value)
    if not raw:
        return False

    try:
        parsed = urlparse(raw)
    except ValueError:
        return False

    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _rows(row: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = row.get(key)
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _english(source: Any) -> dict[str, Any]:
    """The `en` object of a translations column, or an empty dict."""
    if not isinstance(source, dict):
        return {}
    english = source.get("en")
    return english if isinstance(english, dict) else {}


def _english_coverage(row: dict[str, Any]) -> tuple[int, int]:
    """(translated, translatable) across the project and its modules."""
    english = _english(row.get("translations"))
    done = sum(1 for field in TRANSLATABLE_FIELDS if _text(english.get(field)))
    total = len(TRANSLATABLE_FIELDS)

    for module in _rows(row, "project_modules"):
        module_en = _english(module.get("translations"))
        for field in ("title", "description"):
            # Only count a field that exists in the primary language: an empty
            # source field has nothing to translate.
            if _text(module.get(field)):
                total += 1
                done += 1 if _text(module_en.get(field)) else 0

    return done, total


def _check(key: str, status: CheckStatus, message: str) -> AnalysisCheck:
    return AnalysisCheck(key=key, status=status, message=message)


def build_checks(row: dict[str, Any]) -> list[AnalysisCheck]:
    """Every operational rule, in report order."""
    published = row.get("editorial_status") == "PUBLISHED"
    checks: list[AnalysisCheck] = []

    # --- identity -----------------------------------------------------------
    if _text(row.get("name")) and _text(row.get("slug")):
        checks.append(_check("identity", CheckStatus.OK, "Nome e slug definidos."))
    else:
        checks.append(_check("identity", CheckStatus.FAIL, "Projeto sem nome ou sem slug."))

    if _text(row.get("client")):
        checks.append(_check("client", CheckStatus.OK, "Cliente informado."))
    else:
        checks.append(_check("client", CheckStatus.WARN, "Projeto sem cliente associado."))

    # --- enum domains -------------------------------------------------------
    category = _text(row.get("category"))
    if category in VALID_CATEGORIES:
        checks.append(_check("category", CheckStatus.OK, "Categoria valida: " + category + "."))
    else:
        checks.append(
            _check("category", CheckStatus.FAIL, "Categoria fora do dominio: " + (category or "vazia") + ".")
        )

    status = _text(row.get("status"))
    if status in VALID_STATUSES:
        checks.append(_check("status", CheckStatus.OK, "Status valido: " + status + "."))
    else:
        checks.append(
            _check("status", CheckStatus.FAIL, "Status fora do dominio: " + (status or "vazio") + ".")
        )

    editorial = _text(row.get("editorial_status"))
    if editorial in VALID_EDITORIAL:
        checks.append(
            _check("editorial_status", CheckStatus.OK, "Status editorial valido: " + editorial + ".")
        )
    else:
        checks.append(
            _check(
                "editorial_status",
                CheckStatus.FAIL,
                "Status editorial invalido: " + (editorial or "vazio") + ".",
            )
        )

    # --- description --------------------------------------------------------
    description = _text(row.get("description"))
    if not description:
        checks.append(
            _check(
                "description",
                CheckStatus.FAIL if published else CheckStatus.WARN,
                "Projeto publicado sem descricao." if published else "Projeto sem descricao.",
            )
        )
    elif len(description) < MIN_DESCRIPTION_LENGTH:
        checks.append(
            _check(
                "description",
                CheckStatus.WARN,
                "Descricao curta: " + str(len(description)) + " caracteres.",
            )
        )
    else:
        checks.append(_check("description", CheckStatus.OK, "Descricao preenchida."))

    # --- publication coherence ----------------------------------------------
    visible = bool(row.get("visible"))
    if published == visible:
        checks.append(
            _check(
                "publication_consistency",
                CheckStatus.OK,
                "Publicado e visivel." if published else "Nao publicado e oculto.",
            )
        )
    elif published:
        checks.append(
            _check("publication_consistency", CheckStatus.FAIL, "Publicado porem marcado como oculto.")
        )
    else:
        checks.append(_check("publication_consistency", CheckStatus.FAIL, "Visivel porem nao publicado."))

    if published:
        if row.get("published_at"):
            checks.append(_check("published_at", CheckStatus.OK, "Data de publicacao registrada."))
        else:
            checks.append(
                _check("published_at", CheckStatus.WARN, "Publicado sem data de publicacao registrada.")
            )

    # --- presentation assets ------------------------------------------------
    if _text(row.get("poster_url")):
        checks.append(_check("poster", CheckStatus.OK, "Poster configurado."))
    else:
        checks.append(
            _check(
                "poster",
                CheckStatus.FAIL if published else CheckStatus.WARN,
                "Projeto publicado sem poster." if published else "Projeto sem poster.",
            )
        )

    modules = _rows(row, "project_modules")
    if modules:
        checks.append(_check("modules", CheckStatus.OK, str(len(modules)) + " modulo(s) de apresentacao."))
    else:
        checks.append(
            _check(
                "modules",
                CheckStatus.FAIL if published else CheckStatus.WARN,
                "Projeto publicado sem modulos." if published else "Projeto sem modulos.",
            )
        )

    gallery = _rows(row, "project_gallery")
    if gallery:
        checks.append(_check("gallery", CheckStatus.OK, str(len(gallery)) + " imagem(ns) na galeria."))
    else:
        checks.append(_check("gallery", CheckStatus.WARN, "Galeria vazia."))

    missing_presentation = [field for field in PRESENTATION_FIELDS if not _text(row.get(field))]
    if missing_presentation:
        checks.append(
            _check(
                "presentation",
                CheckStatus.WARN,
                "Apresentacao incompleta: " + ", ".join(missing_presentation) + ".",
            )
        )
    else:
        checks.append(_check("presentation", CheckStatus.OK, "Apresentacao completa."))

    tech_stack = row.get("tech_stack")
    if isinstance(tech_stack, list) and tech_stack:
        checks.append(
            _check("tech_stack", CheckStatus.OK, str(len(tech_stack)) + " tecnologia(s) listada(s).")
        )
    else:
        checks.append(_check("tech_stack", CheckStatus.WARN, "Stack tecnica nao informada."))

    # --- links --------------------------------------------------------------
    project_url = _text(row.get("project_url"))
    if not project_url:
        checks.append(_check("project_url", CheckStatus.OK, "Sem URL publica (opcional)."))
    elif _is_http_url(project_url):
        checks.append(_check("project_url", CheckStatus.OK, "URL publica valida."))
    else:
        checks.append(_check("project_url", CheckStatus.FAIL, "URL publica invalida."))

    # The demo rule is a coherence check, not a URL check: the flag is the
    # source of truth, and a URL alone must never put a project on the site.
    preview_url = _text(row.get("preview_url"))
    live_enabled = row.get("live_preview_enabled") is True

    if live_enabled and _is_http_url(preview_url):
        checks.append(_check("live_preview", CheckStatus.OK, "Demonstracao ao vivo configurada."))
    elif live_enabled and preview_url:
        checks.append(_check("live_preview", CheckStatus.FAIL, "Demo habilitada com URL invalida."))
    elif live_enabled:
        checks.append(_check("live_preview", CheckStatus.FAIL, "Demo habilitada sem URL de preview."))
    elif preview_url:
        checks.append(
            _check("live_preview", CheckStatus.WARN, "URL de preview definida com a demo desabilitada.")
        )
    else:
        checks.append(_check("live_preview", CheckStatus.OK, "Sem demonstracao ao vivo."))

    # --- i18n ---------------------------------------------------------------
    done, total = _english_coverage(row)
    percent = round((done / total) * 100) if total else 100
    if percent == 100:
        checks.append(_check("translations_en", CheckStatus.OK, "Traducao para ingles completa."))
    else:
        checks.append(
            _check(
                "translations_en",
                CheckStatus.WARN,
                "Traducao para ingles em " + str(percent) + "%: " + str(done) + "/" + str(total) + ".",
            )
        )

    # --- freshness ----------------------------------------------------------
    age = days_since(row.get("updated_at"))
    if age is None:
        checks.append(_check("freshness", CheckStatus.WARN, "Sem data de atualizacao valida."))
    elif age > STALE_AFTER_DAYS:
        checks.append(_check("freshness", CheckStatus.WARN, "Sem atualizacao ha " + str(age) + " dias."))
    else:
        checks.append(_check("freshness", CheckStatus.OK, "Atualizado ha " + str(age) + " dia(s)."))

    return checks


# What to do about each failing check. Kept apart from the message so the
# report says what is wrong and, independently, what to do next.
RECOMMENDATIONS = {
    "identity": "Defina nome e slug antes de qualquer publicacao.",
    "client": "Associe o cliente responsavel pelo caso.",
    "category": "Corrija a categoria para um dos valores aceitos pelo schema.",
    "status": "Corrija o status para um dos valores aceitos pelo schema.",
    "editorial_status": "Corrija o status editorial para DRAFT, PUBLISHED ou ARCHIVED.",
    "description": "Escreva uma descricao com pelo menos 80 caracteres.",
    "publication_consistency": "Alinhe status editorial e visibilidade.",
    "published_at": "Republique o projeto para registrar a data de publicacao.",
    "poster": "Faca upload do poster antes de publicar.",
    "modules": "Cadastre ao menos um modulo de apresentacao.",
    "gallery": "Adicione imagens a galeria do projeto.",
    "presentation": "Complete os campos de apresentacao usados pelo viewer.",
    "tech_stack": "Liste as tecnologias usadas no projeto.",
    "project_url": "Corrija a URL publica para um endereco http ou https.",
    "live_preview": "Alinhe live_preview_enabled com uma preview_url http ou https valida.",
    "translations_en": "Complete a traducao para ingles dos campos pendentes.",
    "freshness": "Revise o conteudo do projeto ou confirme que ele esta encerrado.",
}


def analyze_project(row: dict[str, Any]) -> ProjectAnalysis:
    """Runs every rule over one project row."""
    checks = build_checks(row)

    penalty = sum(SCORE_PENALTY[check.status] for check in checks)
    score = max(0, min(100, 100 - penalty))

    failed = [check for check in checks if check.status is CheckStatus.FAIL]
    warned = [check for check in checks if check.status is CheckStatus.WARN]

    if failed:
        status = AnalysisStatus.INCOMPLETE
    elif warned:
        status = AnalysisStatus.ATTENTION
    else:
        status = AnalysisStatus.HEALTHY

    # Failures first: the list is meant to be worked through top to bottom.
    recommendations = [
        RECOMMENDATIONS[check.key] for check in (*failed, *warned) if check.key in RECOMMENDATIONS
    ]

    case_number = row.get("case_number")

    return ProjectAnalysis(
        project_id=str(row.get("id") or ""),
        case_number=case_number if isinstance(case_number, int) else None,
        name=_text(row.get("name")) or None,
        score=score,
        status=status,
        checks=checks,
        warnings=[check.message for check in warned],
        recommendations=recommendations,
    )
