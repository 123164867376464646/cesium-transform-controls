#!/bin/bash

# 发布脚本 - 更新版本并推送到npm
#
# 使用方式:
#   ./scripts/publish.sh          # 默认 patch 版本
#   ./scripts/publish.sh patch    # 小版本更新 (1.1.0 -> 1.1.1)
#   ./scripts/publish.sh minor    # 中版本更新 (1.1.0 -> 1.2.0)
#   ./scripts/publish.sh major    # 大版本更新 (1.1.0 -> 2.0.0)
#
# 注意: 脚本会自动切换npm镜像源 (发布时切到官方源，完成后切回镜像源)

set -e

# npm 镜像源配置
NPM_OFFICIAL_REGISTRY="https://registry.npmjs.org/"
NPM_MIRROR_REGISTRY="https://registry.npmmirror.com/"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 获取版本类型，默认为 patch
VERSION_TYPE=${1:-patch}

# 验证版本类型
if [[ ! "$VERSION_TYPE" =~ ^(major|minor|patch)$ ]]; then
    echo -e "${RED}❌ 无效的版本类型: $VERSION_TYPE${NC}"
    echo "有效选项: major, minor, patch"
    exit 1
fi

echo -e "${GREEN}📦 开始发布流程...${NC}"

# 获取当前 npm 源
ORIGINAL_REGISTRY=$(npm config get registry)

# 如果当前不是官方源，先临时切换到官方源检查登录状态
if [ "$ORIGINAL_REGISTRY" != "$NPM_OFFICIAL_REGISTRY" ]; then
    npm config set registry $NPM_OFFICIAL_REGISTRY --silent
fi

# 检查 npm 登录状态
echo -e "\n${GREEN}🔐 检查 npm 登录状态...${NC}"
NPM_USER=$(npm whoami 2>/dev/null) || NPM_USER=""

if [ -z "$NPM_USER" ]; then
    echo -e "${YELLOW}⚠️  未登录 npm，正在启动登录流程...${NC}"
    npm login
    
    # 再次检查是否登录成功
    NPM_USER=$(npm whoami 2>/dev/null) || NPM_USER=""
    if [ -z "$NPM_USER" ]; then
        echo -e "${RED}❌ npm 登录失败，请手动运行 'npm login' 后重试${NC}"
        # 切回原来的源
        if [ "$ORIGINAL_REGISTRY" != "$NPM_OFFICIAL_REGISTRY" ]; then
            npm config set registry $ORIGINAL_REGISTRY --silent
        fi
        exit 1
    fi
fi

echo -e "${GREEN}✅ 已登录为: ${YELLOW}$NPM_USER${NC}"

# 切回原来的源（构建阶段可以用镜像源加速）
if [ "$ORIGINAL_REGISTRY" != "$NPM_OFFICIAL_REGISTRY" ]; then
    npm config set registry $ORIGINAL_REGISTRY --silent
fi

# 获取当前版本 (使用 npm pkg get，去掉引号)
CURRENT_VERSION=$(npm pkg get version | tr -d '"')
echo -e "\n当前版本: ${YELLOW}$CURRENT_VERSION${NC}"

# 构建项目
echo -e "\n${GREEN}📦 构建项目...${NC}"
npm run build

# 使用 npm version 更新版本 (自动创建 commit 和 tag)
echo -e "\n${GREEN}🔄 更新版本 ($VERSION_TYPE)...${NC}"
npm version $VERSION_TYPE -m "chore: 发布 v%s"

# 获取新版本
NEW_VERSION=$(npm pkg get version | tr -d '"')
echo -e "新版本: ${YELLOW}$NEW_VERSION${NC}"

# 推送到 git
echo -e "\n${GREEN}🚀 推送到 Git...${NC}"
git push
git push --tags

# 获取当前 npm 源
ORIGINAL_REGISTRY=$(npm config get registry)
echo -e "\n📍 当前npm源: $ORIGINAL_REGISTRY"

# 切换到官方源
if [ "$ORIGINAL_REGISTRY" != "$NPM_OFFICIAL_REGISTRY" ]; then
    echo -e "\n${GREEN}🔄 切换到npm官方源...${NC}"
    npm config set registry $NPM_OFFICIAL_REGISTRY
    echo -e "${GREEN}✅ 已切换npm源: $NPM_OFFICIAL_REGISTRY${NC}"
fi

# 发布到 npm
echo -e "\n${GREEN}📤 发布到npm...${NC}"
PUBLISH_SUCCESS=true
npm publish || PUBLISH_SUCCESS=false

# 切回镜像源
if [ "$ORIGINAL_REGISTRY" != "$NPM_OFFICIAL_REGISTRY" ]; then
    echo -e "\n${GREEN}🔄 切换回镜像源...${NC}"
    npm config set registry $NPM_MIRROR_REGISTRY
    echo -e "${GREEN}✅ 已切换npm源: $NPM_MIRROR_REGISTRY${NC}"
fi

# 输出结果
if [ "$PUBLISH_SUCCESS" = true ]; then
    PACKAGE_NAME=$(npm pkg get name | tr -d '"')
    echo -e "\n${GREEN}✅ 发布成功! 版本: v$NEW_VERSION${NC}"
    echo -e "   npm: https://www.npmjs.com/package/$PACKAGE_NAME"
else
    echo -e "\n${RED}❌ npm发布失败，但版本已更新并推送到git${NC}"
    echo "   你可以稍后手动运行: npm publish"
    exit 1
fi
