@echo off
rem CUTLY - reinitialise l'administrateur du site en ligne.
rem Double-cliquez sur ce fichier : il ouvre le bon dossier et lance la commande, puis pose les questions.
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  CUTLY - reinitialisation de l'administrateur du site en ligne
echo  -------------------------------------------------------------
echo  Avant de continuer : sur Netlify, Base de donnees, production, Connect,
echo  copiez la ligne "Read and write". Vous la collerez ci-dessous (clic droit).
echo.
call npm run reset:admin:netlify
echo.
echo  Termine. Vous pouvez fermer cette fenetre.
pause
