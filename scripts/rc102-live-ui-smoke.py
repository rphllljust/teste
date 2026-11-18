#!/usr/bin/env python3
"""Read-only Selenium smoke of deployed CISNE staging. No login or mutations."""
import os
import sys
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

ORIGIN = "https://cisne-web-staging-staging.up.railway.app/"
if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RC102_TARGET_ENV") != "staging":
    raise SystemExit("RC102_BROWSER_NO_GO_CI_STAGING_ONLY")

options = Options()
options.add_argument("--headless=new")
options.add_argument("--disable-gpu")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--window-size=1440,1000")
options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

driver = webdriver.Chrome(options=options)
driver.set_page_load_timeout(35)
wait = WebDriverWait(driver, 25)
try:
    driver.get(ORIGIN)
    if not driver.current_url.startswith(ORIGIN):
        raise AssertionError("RC102_BROWSER_UNEXPECTED_REDIRECT")
    nav = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'nav[aria-label="Módulos empresariais"]')))
    choice = nav.find_element(By.XPATH, ".//button[.//span[normalize-space()='Central de integração']]")
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", choice)
    wait.until(EC.element_to_be_clickable(choice))
    choice.click()
    panel = wait.until(EC.visibility_of_element_located(
        (By.CSS_SELECTOR, 'section[data-testid="integration-hub"]')
    ))
    wait.until(lambda _: "Verificando conexão" not in panel.text)
    text = panel.text
    for expected in (
        "Uma operação, módulos conectados.",
        "Ordens de serviço",
        "Documentos e permissões",
        "Medições e recebíveis",
        "Escolha uma OS",
    ):
        if expected not in text:
            raise AssertionError("RC102_BROWSER_MISSING_"+expected[:55])
    if "Sessão necessária" not in text or "Acesso restrito" not in text:
        raise AssertionError("RC102_BROWSER_MISSING_AUTH_REQUIRED_STATE")
    if "Conexão não comprovada" in text:
        raise AssertionError("RC102_BROWSER_FALSE_DATABASE_OUTAGE")
    if any(x in text for x in ("Erro interno do servidor", "Application error", "Unhandled Runtime Error")):
        raise AssertionError("RC102_BROWSER_REACT_FATAL_ERROR")
    Path("artifacts").mkdir(exist_ok=True)
    driver.save_screenshot("artifacts/rc102-integration-hub-railway-staging.png")
    print("RC102_LIVE_BROWSER_MENU_CLICK_PASS")
    print("RC102_LIVE_BROWSER_HUB_RENDER_PASS")
    print("RC103_LIVE_BROWSER_SESSION_REQUIRED_PASS database_is_ready=true")
    print("RC102_LIVE_BROWSER_SCREENSHOT_SAVED artifacts/rc102-integration-hub-railway-staging.png")
finally:
    driver.quit()
