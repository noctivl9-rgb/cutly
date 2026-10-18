@echo off
rem CUTLY - cree un lien prive (24 h) pour ouvrir l'administration du site en ligne sans mot de passe ni code.
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  CUTLY - lien prive d'administration (valable 24 h)
echo  --------------------------------------------------
echo  Avant de continuer : sur Netlify, Base de donnees, production, Connect,
echo  copiez la ligne "Read and write". Vous la collerez ci-dessous (clic droit).
echo.
call npm run admin:link
echo.
echo  Copiez le lien ci-dessus (selectionnez-le puis Entree), puis ouvrez-le dans votre navigateur.
pause
