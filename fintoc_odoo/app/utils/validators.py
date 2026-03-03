"""
Validadores para datos fiscales mexicanos: CLABE, RFC, CURP.
"""

import re


def validate_clabe(clabe: str) -> tuple[bool, str]:
    """
    Valida un número CLABE mexicano (18 dígitos con dígito verificador).
    Returns (is_valid, message).
    """
    clabe = str(clabe).strip()
    if not clabe.isdigit():
        return False, "CLABE debe contener solo dígitos"
    if len(clabe) != 18:
        return False, f"CLABE debe tener 18 dígitos, tiene {len(clabe)}"

    # Ponderación estándar de CLABE
    weights = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7]
    total = sum(int(clabe[i]) * weights[i] for i in range(17))
    check_digit = (10 - (total % 10)) % 10
    if int(clabe[17]) != check_digit:
        return False, f"Dígito verificador inválido (esperado {check_digit})"

    return True, "CLABE válida"


def get_bank_from_clabe(clabe: str) -> str:
    """Retorna el código de banco (3 dígitos) de una CLABE."""
    return clabe[:3] if len(clabe) >= 3 else ""


BANK_CODES = {
    "002": "BANAMEX", "012": "BBVA", "014": "SANTANDER",
    "021": "HSBC", "030": "BAJIO", "032": "IXE",
    "036": "INBURSA", "037": "INTERACCIONES", "042": "MIFEL",
    "044": "SCOTIABANK", "058": "BANREGIO", "059": "INVEX",
    "060": "BANSI", "062": "AFIRME", "072": "BANORTE",
    "106": "BANK OF AMERICA", "108": "MUFG", "110": "JP MORGAN",
    "112": "BMONEX", "113": "VE POR MAS", "116": "ING",
    "127": "AZTECA", "128": "AUTOFIN", "129": "BARCLAYS",
    "130": "COMPARTAMOS", "131": "BANCO FAMSA", "132": "MULTIVA",
    "133": "ACTINVER", "134": "WAL-MART", "135": "NAFIN",
    "136": "INTERCAM", "137": "BANKAOOL", "138": "ABC CAPITAL",
    "140": "CONSUBANCO", "141": "VOLKSWAGEN", "143": "CIBANCO",
    "145": "BBASE", "147": "BANKAOOL", "148": "PAGATODO",
    "150": "INMOBILIARIO", "155": "ICBC", "156": "SABADELL",
    "166": "BANSEFI", "168": "HIPOTECARIA FEDERAL",
    "600": "MONEXCB", "601": "GBM", "602": "MASARI",
    "605": "VALUE", "606": "FONDOS", "608": "FINAMEX",
    "616": "FIBITEX", "617": "VALMEX", "618": "UNICA",
    "619": "MAPFRE", "620": "PROFUTURO", "621": "CB ACTINVER",
    "622": "OACTIN", "623": "CBURSA", "626": "CBDEUTSCHE",
    "627": "ZURICH", "628": "ZURICHVI", "629": "SU CASITA",
    "630": "CB INTERCAM", "631": "CI BOLSA", "632": "BULLTICK",
    "633": "STERLING", "634": "FINCOMUN", "636": "HDI",
    "637": "ORDER", "638": "AKALA", "640": "CB JPMORGAN",
    "642": "REFORMA", "646": "STP", "648": "EVERCORE",
    "649": "SKANDIA", "651": "SEGMTY", "652": "ASEA",
    "653": "KUSPIT", "655": "SOFIEXPRESS", "656": "UNAGRA",
    "659": "ASP INTEGRA", "670": "LIBERTAD", "674": "CAJA TELEFONISTAS",
    "677": "CAJA POP MEXICANA", "679": "FONDO RESERVAS",
    "680": "CRISTOBAL COLON", "681": "FUNDACION DONDÉ",
    "683": "CAJA MORELIA", "684": "VALE BANJÉRCITO",
    "685": "FINSOPHIA", "686": "INVERCAP", "689": "FOMPED",
    "699": "CoDi VALIDA", "706": "ARCUS",
    "710": "NVIO", "722": "MERCADO PAGO",
    "812": "BBVA BANCOMER2", "846": "STP2",
    "901": "CLS", "902": "SD INDEVAL",
}


def get_bank_name(clabe: str) -> str:
    """Retorna el nombre del banco basado en la CLABE."""
    code = get_bank_from_clabe(clabe)
    return BANK_CODES.get(code, f"Banco desconocido ({code})")


def validate_rfc(rfc: str) -> tuple[bool, str]:
    """
    Valida un RFC mexicano (persona física 13 chars, persona moral 12 chars).
    """
    rfc = str(rfc).strip().upper()
    if not rfc:
        return False, "RFC vacío"

    # Persona moral: 3 letras + 6 dígitos + 3 homoclave
    pattern_moral = r"^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$"
    # Persona física: 4 letras + 6 dígitos + 3 homoclave
    pattern_fisica = r"^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$"
    # RFC genérico
    generics = {"XAXX010101000", "XEXX010101000"}

    if rfc in generics:
        return True, "RFC genérico válido"
    if re.match(pattern_moral, rfc):
        return True, "RFC persona moral válido"
    if re.match(pattern_fisica, rfc):
        return True, "RFC persona física válido"

    return False, f"RFC con formato inválido: {rfc}"


def format_mxn(amount: float) -> str:
    """Formatea monto en pesos mexicanos."""
    return f"${amount:,.2f} MXN"


def centavos_to_pesos(centavos: int) -> float:
    """Convierte centavos (Fintoc) a pesos."""
    return centavos / 100.0


def pesos_to_centavos(pesos: float) -> int:
    """Convierte pesos a centavos (Fintoc)."""
    return int(round(pesos * 100))
